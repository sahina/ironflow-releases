// Event names as a typed contract. Shared between producers (trigger, emit) and
// consumers (function triggers, projections, waitForEvent).

export const EVENTS = {
  OrderPlaced: "order.placed",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
