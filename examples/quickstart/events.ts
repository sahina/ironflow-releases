// Event names as a typed contract. Shared between producers (trigger, emit) and
// consumers (function triggers, projections, waitForEvent).

export const EVENTS = {
  OrderPlaced: "order.placed",
  // Emitted by the cron scheduler, not by app code. A cron trigger still needs
  // an event name — the schedule emits this, and that event runs the function.
  HourlyReportTick: "order.report.tick",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
