// Event names as a typed contract. In this example function triggers and
// stream event names are the same set — OrderCreated and OrderShipped fire
// both the aggregate handlers and get recorded in the entity stream as
// past-tense facts. STREAM_EVENTS is a superset because the full audit trail
// includes states the worker doesn't process (OrderConfirmed, OrderPacked,
// OrderDelivered).

export const EVENTS = {
  OrderCreated: "OrderCreated",
  OrderShipped: "OrderShipped",
} as const;

export const STREAM_EVENTS = {
  OrderCreated: "OrderCreated",
  OrderConfirmed: "OrderConfirmed",
  OrderPacked: "OrderPacked",
  OrderShipped: "OrderShipped",
  OrderDelivered: "OrderDelivered",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
export type StreamEventName = (typeof STREAM_EVENTS)[keyof typeof STREAM_EVENTS];
