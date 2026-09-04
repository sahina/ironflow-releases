# Payments context

TypeScript worker. Sole writer of `payment-{orderId}` streams and the only caller of
the gateway. Shared vocabulary is in [`../../CONTEXT-MAP.md`](../../CONTEXT-MAP.md).

## Responsibilities

- React to `order.released` with one payment attempt.
- Run `authorize` and `capture` as separate durable steps against the local gateway
  simulator.
- Append `payment.authorized`, then `payment.captured`, or `payment.declined`.
- Register the `payment.*` schemas it owns before reporting ready. Register the
  `properties.data` subschema of each contract file, never the `{data, metadata}` test
  envelope; the same applies to any handler-side schema mirroring a contract.
- Register `demo.payment.continue` as well. The plan assigns that control event to a
  web bootstrap script that does not exist, and an unregistered event is one the engine
  validates nothing on. This context is its only consumer and the only process here
  that boots, so it registers it.

## Rules this context enforces

- One attempt per order. A decline is final and no retry follows.
- Authorization is a hold, not a completed payment. This context never publishes
  anything that lets an order be treated as paid before capture.
- Gateway calls are keyed by a stable idempotency key derived from the order and the
  operation, never from process-local randomness. Presenting a key with different
  parameters is refused, not replayed — a key is a promise that the request behind it
  is unchanged.
- The stream is read and the domain asked *before* the gateway is called. Calling the
  external system first and discovering afterwards that the domain refuses leaves a
  hold this context has taken and cannot record.
- A version conflict proves the stream moved, not that this fact won. Every conflict is
  verified by re-reading; a fact that lost to something else fails the run loudly. When
  the attempt settled while a step was at the gateway, the stream's recorded outcome
  wins over the step's own.

## Demo scenarios

The payment method token selects the outcome: `pm_success` authorizes and captures,
`pm_decline` declines authorization, and `pm_crash` authorizes and then waits for the
`demo.payment.continue` control event so a presenter can crash and restart the worker
between the two steps.

## Where it keeps things

The gateway ledger is `payments-gateway.db` under the run's `.data/` directory, which
`make reference-app-reset` deletes and nothing else touches. One row per idempotency
key, with the external side-effect count — that column is the crash proof's evidence.

## Boundaries

- Never writes an `order-*` stream; it publishes payment facts and Ordering reacts.
- The gateway simulator and its SQLite database are private to this service. They exist
  to make an external side effect countable, not to be a shared application database.
