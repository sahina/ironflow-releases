import { createProjection } from "@ironflow/node";
import { EVENTS, type Stage } from "./events.js";
import type { LearnedRule } from "./reconcile.js";

// ── Operational projection ─────────────────────────────────────
//
// Carries an explicit `stage` and `deadline` per open case. The cron sweep
// reads THIS and switches on stage — it never reasons over event history to
// work out where a case got to. That inference is the same raw-history smell
// the design objects to, relocated into the operational path.
//
// Managed projection: no await, no Date.now(), no randomness, no env reads,
// and never mutate-then-return the state argument. Time comes from
// event.timestamp so a rebuild reproduces the same deadlines exactly.
// ────────────────────────────────────────────────────────────────

const DEADLINE_HOURS = 24;

// runId is carried because approve() matches on data.runId
// (agent/approve.ts:39) — the sweep cannot settle a pending approval without
// it. It arrives on the case.action.proposed payload.
export type OperationalState = Record<
  string,
  { caseId: string; counterparty: string; runId: string; stage: Stage; deadline: string }
>;

interface ProjectionEvent {
  name: string;
  timestamp: string;
  data: unknown;
}

function deadlineFrom(timestamp: string): string {
  return new Date(new Date(timestamp).getTime() + DEADLINE_HOURS * 3600_000).toISOString();
}

const STAGE_FOR_EVENT: Record<string, Stage> = {
  [EVENTS.CaseEscalated]: "escalated",
  [EVENTS.CaseActionProposed]: "awaiting-approval",
  [EVENTS.CaseContactSent]: "awaiting-reply",
  [EVENTS.CaseResolved]: "closed",
  [EVENTS.CaseUnresolved]: "closed",
};

export const caseOperations = createProjection({
  name: "reconciliation-case-operations",
  events: [
    EVENTS.CaseEscalated,
    EVENTS.CaseActionProposed,
    EVENTS.CaseContactSent,
    EVENTS.CaseResolved,
    EVENTS.CaseUnresolved,
  ],
  initialState: (): OperationalState => ({}),
  handler: (state: OperationalState, event: ProjectionEvent): OperationalState => {
    const data = event.data as { caseId?: string; counterparty?: string; runId?: string };
    if (!data?.caseId) return state;
    const stage = STAGE_FOR_EVENT[event.name];
    if (!stage) return state;
    const prev = state[data.caseId];
    return {
      ...state,
      [data.caseId]: {
        caseId: data.caseId,
        counterparty: data.counterparty ?? prev?.counterparty ?? "",
        runId: data.runId ?? prev?.runId ?? "",
        stage,
        deadline: deadlineFrom(event.timestamp),
      },
    };
  },
});

// ── Curated projection ─────────────────────────────────────────
//
// Reads case.resolved AND NOTHING ELSE. That single-event subscription is
// what makes "memory is not raw audit history" verifiable by reading this
// config, rather than a claim in a README. tests/memory.test.ts asserts it.
// ────────────────────────────────────────────────────────────────

export type CuratedState = Record<string, LearnedRule[]>;

export const curatedRules = createProjection({
  name: "reconciliation-curated-rules",
  events: [EVENTS.CaseResolved],
  initialState: (): CuratedState => ({}),
  handler: (state: CuratedState, event: ProjectionEvent): CuratedState => {
    const data = event.data as { counterparty?: string; rule?: LearnedRule };
    if (!data?.counterparty || !data.rule) return state;
    const existing = state[data.counterparty] ?? [];
    // Rules are keyed by a hash of counterparty + predicate, so a duplicate
    // learn converges instead of colliding. No optimistic concurrency needed.
    if (existing.some((r) => r.key === data.rule!.key)) return state;
    return { ...state, [data.counterparty]: [...existing, data.rule] };
  },
});
