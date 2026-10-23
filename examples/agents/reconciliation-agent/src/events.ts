// Event names shared by the agent, the sweep, the scripts, and the projections.

export const EVENTS = {
  StatementReceived: "statement.received",
  CaseRequested: "reconciliation.case.requested",
  CaseOpened: "case.opened",
  CaseMatchedDeterministic: "case.matched.deterministic",
  CaseEscalated: "case.escalated",
  CaseActionProposed: "case.action.proposed",
  CaseContactApproved: "case.contact.approved",
  CaseContactSent: "case.contact.sent",
  CaseReplyReceived: "case.reply.received",
  CaseResolved: "case.resolved",
  CaseUnresolved: "case.unresolved",
  // ONE event name carries both the human reply and the swept timeout.
  // EventFilter takes a single event name plus a match expression, so one
  // wait cannot name two event types, and two waits would put the run back
  // in reach of the engine TTL that fails it.
  CaseResolutionSignal: "case.resolution.signal",
  // Trigger.event is required even on a cron-only trigger (types.ts) — this
  // is the tick the scheduler fires, not a domain event.
  SweepTick: "reconciliation.sweep.tick",
  // The event approve() waits for in src/agent.ts. The cron sweep and the
  // manual-approve script publish this same name; one constant instead of
  // three raw copies that can drift apart.
  ApproveContact: "reconciliation.contact.approved",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

export type Stage = "escalated" | "awaiting-approval" | "awaiting-reply" | "closed";

export interface ResolutionSignal {
  caseId: string;
  kind: "reply" | "timeout";
  replyClassification?: string;
  confirmedActionId?: string;
}
