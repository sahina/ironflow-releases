import { serverUrl } from "./config.js";
import { createClient, createFunction } from "@ironflow/node";
import { EVENTS } from "./events.js";
import type { OperationalState } from "./memory.js";

const client = createClient({ serverUrl });

// ── Deadline sweep ─────────────────────────────────────────────
//
// The engine FAILS a run whose waitForEvent TTL elapses (scheduler.go; the
// documented contract in agent/approve.ts). So both gates get their deadline
// event from here, before any TTL can fire, and the run resumes through its
// own branch instead.
//
// It switches on the operational projection's `stage` field. It does not
// reason over event history to work out where a case got to — that inference
// is the same raw-history smell the design objects to, moved into the
// operational path.
//
// DEMO AFFORDANCE, NOT PRODUCTION: this publishes into agent.approve.contact,
// so anything with permission to emit that event can settle any pending
// approval. A real deployment locks that subject down. tests/sweep.test.ts
// asserts this can only ever emit approved:false, and approve() correlates
// on data.runId, so one deadline rejects exactly one run.
// ────────────────────────────────────────────────────────────────

type Entry = OperationalState[string];

export function deadlineEventFor(
  entry: Entry,
  now: string,
): { event: string; data: Record<string, unknown> } | null {
  if (Date.parse(now) < Date.parse(entry.deadline)) return null;

  switch (entry.stage) {
    case "awaiting-approval":
      // Unreachable by convention (agent.ts's `ops` always carries run.id
      // from the first event), not by construction — memory.ts's fallback
      // chain terminates at "". A rejection correlating on an empty runId
      // matches nothing, so the run would still die on the engine TTL: the
      // exact failure this file exists to prevent, arriving silently. Refuse
      // rather than emit a rejection nobody is listening for.
      if (!entry.runId) return null;
      // A GENUINE rejection, not an impersonated approval. The audit trail
      // records who declined and why.
      return {
        event: EVENTS.ApproveContact,
        data: {
          // approve() matches on data.runId (agent/approve.ts:39). caseId is
          // carried alongside for the audit trail and the step id below.
          runId: entry.runId,
          caseId: entry.caseId,
          approved: false,
          approver: "system:ttl",
          reason: "no approver responded",
        },
      };
    case "awaiting-reply":
      return {
        event: EVENTS.CaseResolutionSignal,
        data: { caseId: entry.caseId, kind: "timeout" },
      };
    case "escalated":
    case "closed":
      return null;
  }
}

// The handler may call `new Date()` — the projection determinism rules apply
// to createProjection handlers only. deadlineEventFor takes `now` as a
// parameter precisely so it stays pure and testable.
export const sweepDeadlines = createFunction(
  {
    id: "reconciliation-deadline-sweep",
    name: "Reconciliation deadline sweep",
    triggers: [{ event: EVENTS.SweepTick, cron: "*/5 * * * *" }],
    recording: true,
  },
  async ({ step, logger }) => {
    const { due, skippedMissingRunId } = await step.run("sweep", async () => {
      // projections.get returns a ProjectionStateResult wrapper, not the
      // state itself (statement.ts does the same unwrap). An empty or
      // never-written projection returns state: {} with version 0 rather
      // than throwing, so no defensive fallback is needed.
      const result = await client.projections.get<OperationalState>("reconciliation-case-operations");
      const now = new Date().toISOString();
      const due: { event: string; data: Record<string, unknown> }[] = [];
      let skippedMissingRunId = 0;
      for (const entry of Object.values(result.state)) {
        const next = deadlineEventFor(entry, now);
        if (next) {
          due.push(next);
        } else if (
          entry.stage === "awaiting-approval" &&
          !entry.runId &&
          Date.parse(now) >= Date.parse(entry.deadline)
        ) {
          // deadlineEventFor's null conflates "not due yet", "closed", and
          // "missing runId" — re-check here so the log can tell a case that
          // vanished with no trace apart from one that is simply not due.
          skippedMissingRunId++;
        }
      }
      return { due, skippedMissingRunId };
    });

    for (const item of due) {
      // Template-literal step id — a constant inside a loop memoizes on the
      // first iteration.
      await step.run(`emit-${String(item.data.caseId)}-${item.event}`, async () =>
        client.emit(item.event, item.data),
      );
    }

    logger.info("sweep complete", { emitted: due.length, skippedMissingRunId });
    return { emitted: due.length, skippedMissingRunId };
  },
);
