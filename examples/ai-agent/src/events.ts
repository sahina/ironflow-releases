// Event names as a typed contract. Shared between producers (trigger, emit) and
// consumers (function triggers, projections, waitForEvent).

export const EVENTS = {
  AgentResearch: "agent.research",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
