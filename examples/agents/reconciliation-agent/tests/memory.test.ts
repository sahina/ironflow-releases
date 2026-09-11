import { describe, expect, it } from "vitest";
import { caseOperations, curatedRules, type CuratedState, type OperationalState } from "../src/memory.js";
import { EVENTS } from "../src/events.js";

// The SDK types config.handler as the managed|external union, which requires
// a ctx third argument our reducers never read. Narrow to the 2-arg reducer
// shape actually implemented so these direct unit calls typecheck.
type Reducer<S> = (state: S, event: { name: string; timestamp: string; data: unknown }) => S;
const operationalHandler = caseOperations.config.handler as Reducer<OperationalState>;
const curatedHandler = curatedRules.config.handler as Reducer<CuratedState>;

describe("curated memory is not raw audit history", () => {
  // Criterion 5, as a structural property a reviewer can verify by reading the
  // projection config — not as a promise in prose.
  it("subscribes to case.resolved and nothing else", () => {
    expect(curatedRules.config.events).toEqual([EVENTS.CaseResolved]);
  });

  it("never subscribes to the raw audit events", () => {
    for (const noisy of [EVENTS.CaseEscalated, EVENTS.CaseActionProposed, EVENTS.CaseContactSent]) {
      expect(curatedRules.config.events).not.toContain(noisy);
    }
  });
});

describe("projections are deterministic", () => {
  it("derives the operational deadline from event.timestamp, not wall clock", () => {
    const event = {
      name: EVENTS.CaseEscalated,
      timestamp: "2026-09-09T12:00:00.000Z",
      data: { caseId: "case-1", counterparty: "Vendor A", runId: "run-1" },
    };
    const a = operationalHandler(caseOperations.config.initialState!(), event);
    const b = operationalHandler(caseOperations.config.initialState!(), event);
    expect(a).toEqual(b);
    expect(a["case-1"]!.deadline).toBe("2026-09-10T12:00:00.000Z");
  });

  it("does not mutate the state argument", () => {
    const initial = caseOperations.config.initialState!();
    const next = operationalHandler(initial, {
      name: EVENTS.CaseEscalated,
      timestamp: "2026-09-09T12:00:00.000Z",
      data: { caseId: "case-1", counterparty: "Vendor A" },
    });
    expect(initial).toEqual({});
    expect(next).not.toBe(initial);
  });

  it("keys curated rules so a duplicate learn converges", () => {
    const event = {
      name: EVENTS.CaseResolved,
      timestamp: "2026-09-09T12:00:00.000Z",
      data: {
        caseId: "case-1",
        counterparty: "Vendor A",
        rule: {
          key: "abc123",
          counterparty: "Vendor A",
          predicate: { kind: "label-prefix", prefix: "ADJ-" },
          actionId: "reassign-to-sibling",
          learnedAt: "2026-09-09T12:00:00.000Z",
        },
      },
    };
    const once = curatedHandler(curatedRules.config.initialState!(), event);
    const twice = curatedHandler(once, event);
    expect(twice["Vendor A"]).toHaveLength(1);
  });
});
