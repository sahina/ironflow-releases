# DDD Order Management

A working example of **Domain-Driven Design** patterns implemented on Ironflow.

## From Quickstart to DDD

In the [quickstart](../quickstart/), you saw the four pillars of Continuous History: **emit → react → derive → rewind**. Here's how DDD patterns organize those same pillars:

- **Aggregates** guard the **emit** — invariants are enforced before appending events to entity streams
- **Command handlers** orchestrate the **react** — sagas coordinate multi-step processes with compensation
- **Projections** are the **derive** — CQRS read models built from the event stream
- **Entity stream replay** is the **rewind** — the full history of every order, replayable at any time

## Commands vs Events

Ironflow uses `emit()` for all messages — the infrastructure doesn't distinguish between commands and events. The distinction is in **naming convention** and **how you use them**:

|                      | Commands                                    | Events                                      |
| -------------------- | ------------------------------------------- | ------------------------------------------- |
| **Naming**           | Imperative: `create.order`, `fulfill.order` | Past tense: `order.placed`, `order.shipped` |
| **Meaning**          | Intent — "I want this to happen"            | Fact — "This already happened"              |
| **Can be rejected?** | Yes (validation may fail)                   | No (it's a recorded fact)                   |
| **Stored in**        | Transient (triggers a function)             | Entity stream (permanent history)           |

Both flow through the same `emit()` → function trigger pipeline.

## Domain Model

```text
create.order (command)
  → place-order (validates, appends to entity stream)
    → order.placed (domain event)
      → fulfill-order (saga)
        → order.confirmed (payment step)
        → order.shipped (shipping step)
        → [on failure] order.cancelled (compensation)
```

## DDD Pattern Mapping

| DDD Pattern       | Ironflow Primitive  | Code Location                                              |
| ----------------- | ------------------- | ---------------------------------------------------------- |
| Aggregate         | Entity Stream       | `place-order` handler — reads stream, validates, appends   |
| Command           | `emit()`            | `create.order` — imperative intent                         |
| Domain Event      | `streams.append()`  | `order.placed`, `order.confirmed`, `order.shipped`         |
| Read Model (CQRS) | Projection          | `order-summary` (per-order), `order-dashboard` (aggregate) |
| Saga              | Durable workflow    | `fulfill-order` with `step.compensate()`                   |
| Compensation      | `step.compensate()` | Payment reversal on saga failure                           |
| Integration Event | `step.publish()`    | `notifications.order-shipped` topic                        |

## Running It

### 1. Build and start the Ironflow server

From the repository root:

```bash
make all                       # Build binary and dashboard
./build/ironflow serve --dev   # Start server at localhost:9123
```

### 2. Build the JS SDK and install dependencies

```bash
cd examples/ddd-order-management
pnpm -C ../../sdk/js build   # Build the JS SDK (examples link to local packages)
pnpm install
```

### 3. Start the worker

```bash
pnpm worker
```

### 4. Start the UI

In another terminal:

```bash
cd examples/ddd-order-management
pnpm dev
```

Open <http://localhost:3000>.

### 5. Place an order

Use the UI form, or via CLI:

```bash
ironflow emit create.order --data '{"orderId":"ord-1","customerId":"cust-1","items":[{"sku":"WIDGET-1","qty":2,"price":24.99}],"total":49.98}'
```

### 6. View the results

- **Order List** — see the `order-dashboard` projection update with stats
- **Order Detail** — see the `order-summary` read model + entity stream timeline showing every event

## Learn More

- [Why DDD with Ironflow](../../docs/explanation/ddd/why-ddd.md)
- [Aggregates & Entity Streams](../../docs/explanation/ddd/aggregates.md)
- [Commands, Events & Reactions](../../docs/explanation/ddd/commands-and-events.md)
- [CQRS with Projections](../../docs/explanation/ddd/cqrs.md)
- [Sagas & Process Managers](../../docs/explanation/ddd/sagas.md)
- [Putting It All Together](../../docs/explanation/ddd/putting-it-together.md)
