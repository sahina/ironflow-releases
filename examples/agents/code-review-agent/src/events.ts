// Event names shared between trigger script and the agent.

export const EVENTS = {
  PrOpened: "pr.opened",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
