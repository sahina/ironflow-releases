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

## Decisions this slice locked in

Four things later slices and the other two services inherit.

**Registered schemas are inlined, not `$ref`-ed.** The engine refuses external
`$ref` resolution when it compiles a registered schema
(`internal/schemacache/cache.go`): a caller who can register a schema could
otherwise make the server read local files. A contract file registered verbatim
therefore fails to compile, because every one of them reaches
`common.v1.schema.json` by URL. `LoadDataSchema` copies each referenced
definition into a local `$defs` and rewrites the pointer. Payments and
Notifications need the same transformation.

**Dedup is the append's own two guards, not a KV claim.** The SDK ships
`CommandDedup`, and this service uses none of it. An expected version and a
stable idempotency key already make every write idempotent: a second
`place.order` loses the version-0 check, and a redelivered fact reuses its key
and gets the original event back. Keys are `place:`, `approve:`, `release:` and
`outcome:`, each derived from the order ID alone.

**The read model is one unpartitioned projection.** `@ironflow/browser` can read
and subscribe to a projection, including one partition of it, but it cannot list
the partitions of one. A projection partitioned by order ID would leave the
operations page unable to enumerate the queue, so `orders` keeps every order in
one state document, keyed by ID.

**`contracts/` is found by walking up.** `REFERENCE_APP_CONTRACTS_DIR` overrides
it; otherwise the first ancestor holding `contracts/catalog.json` wins, which
resolves to the same directory from the service root at runtime and from a
package directory under `go test`. Nothing is copied out of `contracts/`.

## Layout

| File | Holds |
| --- | --- |
| `internal/order/model.go` | The domain: pricing, folding, and every decision. No SDK types. |
| `internal/order/streams.go` | The `Streams` seam and its Ironflow implementation. |
| `internal/order/functions.go` | The four functions, and each step body as a method a test can call. |
| `internal/order/projection.go` | The managed `orders` read model. |
| `internal/order/contracts.go` | Catalog and schema loading. |
| `cmd/orders/main.go` | Schema registration, then the pull-mode worker. |

**`order.ErrConflict` wraps `ironflow.ErrConflict`.** A version conflict reaches
the SDK as Connect `ABORTED`, surfaced as HTTP 409 and `ironflow.ErrConflict`.
`streams.go` re-wraps it as `order.ErrConflict` so the domain never imports the
SDK's error set, and `IsConflict` is the only test. Payments should spell it the
same way rather than inventing a third name.

## A race a scripted driver can hit

`order.approved` must not be emitted before the `order-approval-process` run has
parked on its `wait-approval` step. The engine creates the waiting correlation at
yield time (`internal/engine/yield_orchestrator.go`) and matches incoming events
against the correlations that exist at arrival
(`internal/engine/scheduler.go`, `internal/eventtrigger/helper.go` — the wake is
explicitly not time-bounded). An approval that lands first matches nothing, the
wait never resumes, and the order sits in `pending_approval` until
`ApprovalWaitTimeout` — seven days, with no error anywhere.

A person cannot approve that fast: the operations queue only offers the button
once the projection has the order, which is itself downstream of `order.placed`.
A script can. Anything that drives approval automatically — the live gate, and
Task 12's Chromium walkthrough — must wait for the order to appear in the read
model first, and ideally for the process-manager run to be waiting, before it
emits `approve.order`.
