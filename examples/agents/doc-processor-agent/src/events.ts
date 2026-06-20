// Event names as a typed contract. Shared between trigger scripts and the agent.

export const EVENTS = {
  DocReceived: "doc.received",
  DocProcessed: "doc.processed",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
