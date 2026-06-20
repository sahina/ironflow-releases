// Event names as a typed contract.
//   EVENTS — function triggers (imperative commands)
//   STREAM_EVENTS — domain events recorded in entity streams (past-tense
//                   facts; upcasters and projections depend on these names)

export const EVENTS = {
  CreateOrder: "create.order",
} as const;

export const STREAM_EVENTS = {
  OrderPlaced: "order.placed",
  OrderShipped: "order.shipped",
  OrderCancelled: "order.cancelled",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
export type StreamEventName = (typeof STREAM_EVENTS)[keyof typeof STREAM_EVENTS];
