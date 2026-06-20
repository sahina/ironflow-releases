// Event names as a typed contract. Shared between producers (trigger, emit) and
// consumers (function triggers, projections, waitForEvent).

export const EVENTS = {
  TodoAdded: "todo.added",
  TodoToggled: "todo.toggled",
  TodoDeleted: "todo.deleted",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
