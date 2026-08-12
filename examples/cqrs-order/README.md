# CQRS + Event Sourcing — Ironflow Example

A runnable Next.js implementation of [`docs/tutorials/cqrs-walkthrough.mdx`](../../docs/tutorials/cqrs-walkthrough.mdx).
Every step in the tutorial maps to a file here so you can read the doc with the code open.

## What this example shows

- Command shape split into `data` (domain) and `metadata` (plumbing)
- Thin HTTP endpoint that dispatches a command and returns `202 Accepted`
- Command handler orchestrating dedup → enrich → load → decide → append
- "Aggregate" as a pure fold + decide pattern, no framework class
- Event appended with `expectedVersion` optimistic concurrency
- Two managed projections: a per-order detail view and a per-customer partitioned list
- Real-time UI via `subscribeToProjection`
- Command idempotency backed by an Ironflow KV bucket (first-writer-wins)

## Walkthrough step → file map

| Walkthrough step               | File                                                                                                                             |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Step 1 — Command type          | [`lib/types.ts`](./lib/types.ts)                                                                                                 |
| Step 2 — HTTP endpoint         | [`app/api/orders/route.ts`](./app/api/orders/route.ts) (emits `create.order`)                                                    |
| Step 3 — Command handler       | [`lib/place-order-handler.ts`](./lib/place-order-handler.ts), hosted as the `place-order` function in [`worker.ts`](./worker.ts) |
| Step 4 — Aggregate pattern     | [`lib/aggregate.ts`](./lib/aggregate.ts)                                                                                         |
| Step 5 — Event metadata        | `EventMeta` in [`lib/types.ts`](./lib/types.ts), added in handler                                                                |
| Step 6 — Append                | `streams.append` call in [`lib/place-order-handler.ts`](./lib/place-order-handler.ts)                                            |
| Step 7 — No outbox             | (none — NATS JetStream handles publish automatically)                                                                            |
| Step 8 — Projections           | [`worker.ts`](./worker.ts)                                                                                                       |
| Step 9 — Queries               | [`app/page.tsx`](./app/page.tsx), [`app/orders/[orderId]/page.tsx`](./app/orders/[orderId]/page.tsx)                             |
| Step 10 — Eventual consistency | Optimistic subscription in [`app/orders/[orderId]/page.tsx`](./app/orders/[orderId]/page.tsx)                                    |
| Step 11 — Rebuild              | `POST /api/v1/projections/order-detail-view/rebuild` (run from CLI)                                                              |
| Command idempotency            | [`lib/command-dedup.ts`](./lib/command-dedup.ts)                                                                                 |
| Enrichment (customer/product)  | [`lib/enrichment.ts`](./lib/enrichment.ts) (in-memory demo data)                                                                 |

### Why the route emits instead of calling the handler directly

The walkthrough shows the HTTP route calling `placeOrderHandler(cmd)` directly. The Ironflow server currently requires a worker to register at least one function, so this example hosts the handler as a `place-order` function triggered by `create.order`. The route emits the command; the function executes the same `placeOrderHandler` body. Both paths produce identical CQRS shape — you get durable retries and step memoization for free.

Only `createClient`, `createFunction`, `createProjection`, `createWorker`, `emit`, `streams.*`, `commandDedup()`, and the
browser `ironflow.{configure,getProjection,subscribeToProjection,streams.read}` are
Ironflow SDK calls. Everything else (`customerRepo`, `productCatalog`, `commandDedup`,
`authenticate`, `foldOrder`, `placeOrder`, `placeOrderHandler`) is illustrative user
code you would write in your own app.

## Running it

### 1. Build the server and the JS SDK

From the repo root:

```bash
make all                         # builds ./build/ironflow and the dashboard
pnpm -C sdk/js build             # builds @ironflow/{core,browser,node}
```

### 2. Start the Ironflow server

```bash
./build/ironflow serve --dev     # localhost:9123
```

### 3. Install example deps

```bash
cd examples/cqrs-order
pnpm install
```

### 4. Start the projection worker

```bash
pnpm worker
```

You should see:

```text
CQRS walkthrough worker started
  Functions:
    - place-order              (triggered by create.order)
  Projections:
    - order-detail-view        (per-order, non-partitioned)
    - customer-orders-list     (partitioned by customer.id)
```

### 5. Start the Next.js app (new terminal)

```bash
pnpm dev
```

Open <http://localhost:3000>.

## Try it

1. Pick a customer + product + qty, click **Place Order**.
2. Notice the dashboard below updates via real-time `subscribeToProjection`.
3. Click an order row to open the detail view. The page subscribes to the
   detail projection so you see it hydrate in real time (walkthrough Step 10).
4. Place the same order twice by copying the request in devtools and resending
   with the same `commandId` and `orderId` in the body. Verify dedup two ways:
   the worker log shows the second invocation short-circuiting (no new
   `streams.append` call), and `curl $IRONFLOW_SERVER_URL/api/v1/streams/{orderId}/events`
   returns one event, not two.
5. Rebuild a projection:

   ```bash
   curl -X POST http://localhost:9123/api/v1/projections/order-detail-view/rebuild
   ```

   State clears, replays from the event log, and the UI updates as events
   stream back through.

## What it intentionally skips

- **Schema evolution / upcasters** — see the
  [Event Versioning guide](../../docs/how-to-guides/event-sourcing/versioning.mdx).
- **Ship / cancel** flows — only `order.placed` is emitted. The projections
  handle `order.shipped` / `order.cancelled` so you can extend with another
  command handler and a saga.
- **Auth** — `authenticate()` returns a stub user. Wire up your real auth middleware.

## Related

- Tutorial: [CQRS + Event Sourcing walkthrough](../../docs/tutorials/cqrs-walkthrough.mdx)
- Concept: [CQRS with Projections](../../docs/explanation/ddd/cqrs.md)
- Fuller DDD/saga example: [`examples/ddd-order-management`](../ddd-order-management)
