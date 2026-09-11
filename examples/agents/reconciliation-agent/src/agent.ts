import { agent } from "@ironflow/node/agent";
import { ACTIONS } from "./causes.js";
import { contactKey, draftMessage, sendContact } from "./contact.js";
import { EVENTS, type ResolutionSignal } from "./events.js";
import { parseTriage, triageWith } from "./llm.js";
import { learnRule } from "./reconcile.js";
import { redactCluster } from "./redact.js";
import type { Cluster } from "./reconcile.js";

interface CaseOpened {
  caseId: string;
  periodStart: string;
  cluster: Cluster;
}

// The model proposes; a person or a rule authorizes (criterion 4). A reply
// only counts as authorization when it both classifies as something other
// than "unclear" AND names an action already on the allowlist parseTriage
// enforces on the model's own proposal. Never falls back to the model's
// proposedActionId — that would let an unreadable reply silently authorize
// the model's own unreviewed guess. Pure and exported so the decision is
// testable without a live run.
export function confirmedActionFor(signal: ResolutionSignal): string | null {
  if (!signal.replyClassification || signal.replyClassification === "unclear") return null;
  if (typeof signal.confirmedActionId !== "string" || !ACTIONS.includes(signal.confirmedActionId)) return null;
  return signal.confirmedActionId;
}

// ── Reconciliation case agent ──────────────────────────────────
//
//   redact → llm triage → approve(contact) → send → wait for reply
//                                                       ↓
//                                        case.resolved | case.unresolved
//
// Two durable gates, both routed around the engine's wait-timeout behaviour
// (a TTL elapse FAILS the run — the documented contract, agent/approve.ts):
//
//   approve("contact")  the sweep emits a genuine rejection before the TTL
//   waitForEvent        one event name carries reply AND timeout
//
// Neither gate may sit inside try/catch: the catch swallows the YieldSignal
// and the run completes instead of suspending.
// ────────────────────────────────────────────────────────────────

export const reconciliationCaseAgent = agent(
  {
    id: "reconciliation-case",
    description: "Investigates one unmatched cluster: triage, approved contact, durable reply wait, curated resolution.",
    // Requested through an idempotent event, once per period/counterparty.
    triggers: [{ event: EVENTS.CaseRequested }],
    recording: true,
    memory: {
      streamId: "reconciliation-memory",
      projection: "reconciliation-curated-rules",
    },
  },
  async ({ event, step, run, tool, llm, approve, memory, logger }) => {
    const { caseId, periodStart, cluster } = event.data as CaseOpened;

    // Log identifiers only. Criterion 8 covers logs, and a case object here
    // would put counterparty data straight into engine logs.
    logger.info("case opened", { caseId, stage: "escalated" });

    // runId travels on every operational event: approve() matches on
    // data.runId, so the sweep needs it to settle a stalled approval.
    const ops = { caseId, counterparty: cluster.counterparty, runId: run.id };

    await memory.append(EVENTS.CaseOpened, ops);
    await memory.append(EVENTS.CaseEscalated, ops);

    const redacted = redactCluster(cluster, periodStart);
    const completion = await llm.complete({
      messages: [{ role: "user", content: redacted }],
      call: () => triageWith(redacted),
    });
    const triage = parseTriage(completion);

    await memory.append(EVENTS.CaseActionProposed, { ...ops, proposedActionId: triage.proposedActionId });

    const draft = draftMessage(caseId, cluster.counterparty, triage);

    // An approval gate on an outbound contact where the approver cannot read
    // the outbound contact is theatre — so the draft goes on the gate. The
    // payload is stored as the parked step's input, readable through
    // getRunSteps and the dashboard before anyone approves.
    const decision = await approve("contact", {
      ttl: "72h",
      payload: {
        caseId,
        counterpartyRef: redacted.counterpartyRef,
        deltaCents: cluster.deltaCents,
        classification: triage.classification,
        confidence: triage.confidence,
        proposedActionId: triage.proposedActionId,
        draft,
      },
    });

    if (!decision.approved) {
      logger.info("contact not approved", { caseId, stage: "closed" });
      await memory.append(EVENTS.CaseUnresolved, { ...ops, reason: decision.reason ?? "declined" });
      return { caseId, resolved: false, reason: decision.reason ?? "declined" };
    }

    await tool(sendContact, {
      key: contactKey(run.id, caseId),
      caseId,
      body: draft,
    });
    await memory.append(EVENTS.CaseContactSent, ops);

    // ONE event name, two kinds. The wait TTL sits well beyond the sweep
    // deadline so the engine timeout is unreachable in practice.
    //
    // `match` is a JSON path, not a CEL expression (EventFilter.match,
    // sdk/js/core/src/types.ts) — a bare path, snapshotted from THIS run's
    // triggering event input (`{ caseId, ... }`, statement.ts) at yield
    // time and compared against the same path on the incoming
    // case.resolution.signal event. A comparison expression like
    // `data.caseId == "..."` fails the yield outright (yield_orchestrator.go
    // rejects anything that is not a path). approve() uses the same path
    // mechanism but supplies its run id as a literal via `matchValue`.
    const signal = await step.waitForEvent<ResolutionSignal>("reply", {
      event: EVENTS.CaseResolutionSignal,
      match: "data.caseId",
      timeout: "30d",
    });

    if (signal.data.kind === "timeout") {
      logger.info("no reply before deadline", { caseId, stage: "closed" });
      await memory.append(EVENTS.CaseUnresolved, { ...ops, reason: "no-reply" });
      // The run COMPLETES. "The counterparty did not answer" is a business
      // outcome, not an engine failure.
      return { caseId, resolved: false, reason: "no-reply" };
    }

    // confirmedActionId arrives from outside the process — TypeScript's
    // closed-action-grammar typing erases at runtime, so a malformed or
    // hostile value must be checked against the same allowlist parseTriage
    // already enforced on the model's own proposal before it can reach
    // learnRule. A reply that does not confirm anything is not a reason to
    // fail the run either — it ends the case unresolved, same as no reply
    // at all, distinguished by reason.
    const confirmedActionId = confirmedActionFor(signal.data);
    if (confirmedActionId === null) {
      logger.info("reply did not confirm an action", { caseId, stage: "closed" });
      await memory.append(EVENTS.CaseUnresolved, { ...ops, reason: "unconfirmed-reply" });
      return { caseId, resolved: false, reason: "unconfirmed-reply" };
    }

    const rule = learnRule({
      counterparty: cluster.counterparty,
      predicate: { kind: "label-prefix", prefix: "ADJ-" },
      actionId: confirmedActionId,
      // IronflowEvent.timestamp is typed Date (sdk/js/core/src/types.ts) but
      // arrives as an ISO string over the real REST path — only the
      // in-process test client hands back an actual Date. `new Date(...)`
      // normalizes either input; a bare `.toISOString()` throws on every
      // genuine (non-test) reply. Do not "simplify" this back.
      learnedAt: new Date(signal.timestamp).toISOString(),
    });

    await memory.append(EVENTS.CaseResolved, { ...ops, rule });

    logger.info("case resolved", { caseId, stage: "closed" });
    return { caseId, resolved: true, ruleKey: rule.key };
  },
);
