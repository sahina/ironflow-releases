# Ordering context

Go service. Sole writer of `order-{orderId}` streams and the only authority on order
state. Shared vocabulary is in [`../../CONTEXT-MAP.md`](../../CONTEXT-MAP.md).

## Responsibilities

- Validate `place.order` against the committed catalog, recalculate the total, and
  append `order.placed` at expected version 0.
- Enforce approval rules and append `order.approved`.
- Run the durable approval wait, then append `order.released`.
- React to `payment.captured` with `order.paid`, and to `payment.declined` with
  `order.payment_failed`.
- Own the managed order projection the web application reads.
- Publish `notifications.order-status` after customer-visible state changes.
- Register the schemas it owns (`order.*` facts and `notifications.order-status`) before
  reporting ready. Register the `properties.data` subschema of each contract file, never
  the `{data, metadata}` test envelope.

## Rules this context enforces

- The browser total is a display value. The catalog price is the truth.
- Unknown SKUs, empty item lists, and total mismatches are rejected here, not by the
  wire schema. The `contracts/fixtures/invalid/domain/` fixtures are exactly these cases.
- Only a pending order can be approved.
- `order.paid` follows `payment.captured` only.
- Publishing a notification is never part of an order invariant. A failed publish does
  not fail the order.

## Boundaries

- Never writes a `payment-*` stream.
- Never calls another service over HTTP.
