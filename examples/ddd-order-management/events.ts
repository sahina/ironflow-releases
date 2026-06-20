// Event names as a typed contract. Two namespaces:
//   EVENTS — function triggers and integration events (imperative commands,
//            cross-bounded-context notifications)
//   STREAM_EVENTS — domain events recorded in entity streams (past-tense facts,
//                   part of the aggregate's event contract — upcasters and
//                   projections depend on these names)

export const EVENTS = {
  CreateOrder: "create.order",
  NotificationsOrderShipped: "notifications.order-shipped",
} as const;

export const STREAM_EVENTS = {
  OrderPlaced: "order.placed",
  OrderConfirmed: "order.confirmed",
  OrderShipped: "order.shipped",
  OrderCancelled: "order.cancelled",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
export type StreamEventName = (typeof STREAM_EVENTS)[keyof typeof STREAM_EVENTS];
