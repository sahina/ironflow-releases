# Reference app context map

Domain vocabulary and ownership for the polyglot order-processing reference system.
Runtime, ports, and commands live in `README.md`. Language-level detail lives in each
service `CONTEXT.md`.

## Bounded contexts

| Context       | Directory                       | Language   | Owns                                                              |
| ------------- | ------------------------------- | ---------- | ----------------------------------------------------------------- |
| Ordering      | `services/orders-go`            | Go         | The order stream, approval, and every customer-facing order state |
| Payments      | `services/payments-node`        | TypeScript | The payment stream and the gateway side effects                   |
| Notifications | `services/notifications-python` | Python     | The local delivery log and its resume cursor                      |

`apps/web` is a presentation layer, not a bounded context. It sends commands and reads
the order projection. It never folds raw streams to build order state.

Ironflow is the only integration channel. No context calls another over business HTTP.

## Glossary

- **Order** — a customer purchase of catalog items. Identified by `orderId`, one safe
  Ironflow subject segment. Owned by Ordering.
- **Catalog** — the committed three-product price list in `contracts/catalog.json`.
  Ordering is authoritative for prices and totals; the browser total is display only.
- **Approval** — an operator decision that every order must receive before payment.
  Only a pending order can be approved.
- **Release** — the moment the durable approval wait completes and payment may start.
- **Payment** — one attempt to collect an order total. Owned by Payments. The example
  makes one attempt per order; a decline is final.
- **Authorization** — the gateway hold. It is not proof of payment.
- **Capture** — the gateway collection. Only a capture can make an order paid.
- **Notification** — a recorded local delivery of an order status message. Delivery
  success or failure never changes order state.
- **Demo session** — a `demoSessionId` that filters what the UI shows. Starting a new
  session hides earlier orders; it never deletes history.

## Order states

The customer sees exactly four states: `pending_approval`, `processing_payment`,
`paid`, `payment_failed`. Authorization, capture, and notification delivery are facts
in the timeline, not extra states.

## Stream ownership

| Stream                      | Entity type | Sole writer   |
| --------------------------- | ----------- | ------------- |
| `order-{orderId}`           | `order`     | Ordering      |
| `payment-{orderId}`         | `payment`   | Payments      |
| Local delivery log (SQLite) | —           | Notifications |

Both entity streams are written with optimistic `expectedVersion`. A context never
writes another context's stream; it reacts to the other context's published facts.

## Messages

Commands are requests that may be refused. Facts record what already happened.

| Message                      | Kind          | Publisher     | Consumers                               |
| ---------------------------- | ------------- | ------------- | --------------------------------------- |
| `place.order`                | command       | Web           | Ordering                                |
| `approve.order`              | command       | Web           | Ordering                                |
| `order.placed`               | fact          | Ordering      | Ordering process manager                |
| `order.approved`             | fact          | Ordering      | Ordering process manager (durable wait) |
| `order.released`             | fact          | Ordering      | Payments                                |
| `payment.authorized`         | fact          | Payments      | Projection, timeline                    |
| `payment.captured`           | fact          | Payments      | Ordering                                |
| `payment.declined`           | fact          | Payments      | Ordering                                |
| `order.paid`                 | fact          | Ordering      | Projection, notifications topic         |
| `order.payment_failed`       | fact          | Ordering      | Projection, notifications topic         |
| `notifications.order-status` | topic message | Ordering      | Notifications                           |
| `notification.sent`          | fact          | Notifications | Projection, timeline                    |

`demo.payment.continue` is demonstration scaffolding for the crash scenario. It is not
part of this glossary.

## Causal rules

- An `orderId` is placed once.
- Approval requires a pending order.
- Payment requires a released order.
- `order.paid` follows `payment.captured` only, never `payment.authorized`.
- `order.payment_failed` follows `payment.declined`, and no retry follows it.

## Wire contract

`contracts/` is the shared, language-neutral source of truth:

- `schemas/*.v1.schema.json` — one JSON Schema 2020-12 file per message. Each is an
  envelope of `data` plus `metadata`; `metadata` carries `correlationId` (the order ID),
  `causationId`, `producer`, and `demoSessionId`.

  The envelope is a **test-time** shape. Ironflow carries data and metadata on separate
  channels, so no service ever emits an object of this shape. A service that registers a
  schema with Ironflow, or mirrors one as a handler schema, registers the `properties.data`
  subschema only. Registering the envelope would declare that every payload looks like
  `{data, metadata}` and would fail every handler that validates its input.
- `catalog.json` — the committed catalog.
- `fixtures/` — valid and invalid payloads.
- `fixtures/index.json` — the manifest each language loops over. Fixtures under
  `invalid/schema/` must be rejected by the schema. Fixtures under `invalid/domain/`
  are well formed on the wire on purpose and can only be rejected by Ordering, which
  holds the catalog.

Every language validates the same files. No fixture is copied into a service.

In JSON Schema 2020-12 `format` is an annotation, not an assertion, and the three
validators disagree by default: `ajv-formats` asserts, while Go and Python do not unless
configured to. No fixture may therefore be invalid by a format violation alone. Every
invalid fixture must break a structural keyword as well.
