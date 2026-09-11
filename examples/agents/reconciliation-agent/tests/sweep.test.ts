import { describe, expect, it } from "vitest";
import { deadlineEventFor } from "../src/sweep.js";
import { EVENTS } from "../src/events.js";
import { caseOperations, type OperationalState } from "../src/memory.js";

const NOW = "2026-09-11T00:00:00.000Z";
const entry = (stage: string) => ({
  caseId: "case-1",
  counterparty: "Vendor A",
  runId: "run-1",
  stage: stage as never,
  deadline: "2026-09-10T00:00:00.000Z",
});

describe("the sweep emits the event its stage calls for", () => {
  it("emits a rejection for a case stuck awaiting approval", () => {
    const out = deadlineEventFor(entry("awaiting-approval"), NOW);
    // Deliberately a literal, not EVENTS.ApproveContact: approve() derives
    // this value internally as APPROVE_EVENT_PREFIX + name, and the prefix
    // is not exported, so nothing can import the true value to compare
    // against. If both sides of this assertion read the same constant, a
    // typo or refactor of that constant leaves the test green while the
    // emitted event silently stops matching the gate it exists to settle.
    expect(out?.event).toBe("agent.approve.contact");
    // approve() correlates on runId, not caseId — without this the rejection
    // silently never matches and the run still dies on the engine TTL.
    expect(out?.data.runId).toBe("run-1");
  });

  it("emits a timeout signal for a case stuck awaiting reply", () => {
    const out = deadlineEventFor(entry("awaiting-reply"), NOW);
    expect(out?.event).toBe(EVENTS.CaseResolutionSignal);
    expect(out?.data.kind).toBe("timeout");
  });

  it("emits nothing before the deadline", () => {
    expect(deadlineEventFor(entry("awaiting-reply"), "2026-09-09T00:00:00.000Z")).toBeNull();
  });

  it("emits nothing for a closed case", () => {
    expect(deadlineEventFor(entry("closed"), NOW)).toBeNull();
  });

  it("refuses to emit a rejection with no runId to correlate on", () => {
    // Unreachable by convention, not by construction (memory.ts's fallback
    // chain terminates at ""). A rejection correlating on an empty runId
    // would match nothing, so the run dies on the engine TTL anyway — the
    // exact failure this file exists to prevent, but silently.
    expect(deadlineEventFor({ ...entry("awaiting-approval"), runId: "" }, NOW)).toBeNull();
  });
});

describe("the sweep can never approve anything", () => {
  // The sweep publishes into agent.approve.{name}, so anything that can emit
  // that event can approve any pending approval. This test is what turns the
  // README's "lock this down" warning into a guarantee.
  it("never emits approved:true, at any stage, at any time", () => {
    for (const stage of ["escalated", "awaiting-approval", "awaiting-reply", "closed"]) {
      for (const now of [NOW, "2026-01-01T00:00:00.000Z", "2030-01-01T00:00:00.000Z"]) {
        const out = deadlineEventFor(entry(stage), now);
        if (out?.event === EVENTS.ApproveContact) {
          expect(out.data.approved).toBe(false);
        }
        expect(JSON.stringify(out ?? {})).not.toContain('"approved":true');
      }
    }
  });
});

describe("the sweep depends on the operational projection's runId fallback", () => {
  // Task 4's OperationalState carries `runId` with a fallback chain
  // (data.runId ?? prev?.runId ?? ""), because approve() correlates on
  // runId and NOT every operational event repeats it. Build an entry the
  // same way the sweep actually receives one — through the real projection
  // reducer, fed a run-opening event carrying runId followed by a
  // later-stage event that omits it — and confirm the sweep still emits
  // the right runId. A rejection with the wrong (empty) runId silently
  // never matches approve()'s wait, which is exactly the failure this file
  // exists to prevent.
  const operationalHandler = caseOperations.config.handler as (
    state: OperationalState,
    event: { name: string; timestamp: string; data: unknown },
  ) => OperationalState;

  it("carries runId forward into the emitted rejection when a later event omits it", () => {
    let state = caseOperations.config.initialState!();
    state = operationalHandler(state, {
      name: EVENTS.CaseEscalated,
      timestamp: "2026-09-09T00:00:00.000Z",
      data: { caseId: "case-1", counterparty: "Vendor A", runId: "run-1" },
    });
    // case.action.proposed omits runId, as the real handler payload does
    // (agent.ts appends `{ ...ops, proposedActionId }` where ops always has
    // it — but the fallback is what protects a payload that doesn't).
    state = operationalHandler(state, {
      name: EVENTS.CaseActionProposed,
      timestamp: "2026-09-09T01:00:00.000Z",
      data: { caseId: "case-1", counterparty: "Vendor A" },
    });

    const built = state["case-1"]!;
    expect(built.runId).toBe("run-1");
    expect(built.stage).toBe("awaiting-approval");

    const out = deadlineEventFor(built, NOW);
    expect(out?.event).toBe(EVENTS.ApproveContact);
    expect(out?.data.runId).toBe("run-1");
  });
});
