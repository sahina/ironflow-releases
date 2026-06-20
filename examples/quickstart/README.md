# Quickstart: Continuous History in 5 Minutes

This example builds a simple order processing system in ~80 lines that demonstrates all four pillars of **Continuous History**: emit, react, derive, and rewind.

## What is Continuous History?

Record every change as an immutable event. React with durable workflows. Derive read models automatically. Rewind to any moment for debugging. One system, not four.

## What This Example Builds

A worker that:

- **Reacts** to `order.placed` events with a 3-step durable workflow
- **Derives** order statistics via a projection (pure reducer)
- Supports **rewind** via recorded step execution

## The Four Pillars

### 1. EMIT — Record Events

Events are permanent facts. When you emit `order.placed`, it's recorded forever:

```bash
ironflow emit order.placed --data '{"orderId":"ord-1","total":49.99,"email":"a@b.com"}'
```

### 2. REACT — Durable Workflows

The `processOrder` function triggers on `order.placed` and runs three memoized steps. If the process crashes mid-way, it resumes from the last completed step — not from the beginning.

```typescript
// worker.ts — lines 19-51
const processOrder = createFunction(
  { id: "process-order", triggers: [{ event: "order.placed" }], recording: true },
  async ({ event, step }) => {
    const order = await step.run("validate-order", async () => { ... });
    const payment = await step.run("process-payment", async () => { ... });
    await step.run("send-confirmation", async () => { ... });
  },
);
```

Each `step.run()` is memoized: on retry, completed steps return their cached result instantly.

### 3. DERIVE — Projections

The `orderStats` projection is a pure reducer that builds a read model from the event stream. No manual queries — the projection stays consistent automatically.

```typescript
// worker.ts — lines 56-67
const orderStats = createProjection({
  name: "order-stats",
  events: ["order.placed"],
  initialState: () => ({ totalOrders: 0, totalRevenue: 0 }),
  handler: (
    state: { totalOrders: number; totalRevenue: number },
    event: { name: string; data: unknown },
  ) => ({
    totalOrders: state.totalOrders + 1,
    totalRevenue: state.totalRevenue + ((event.data as { total: number }).total ?? 0),
  }),
});
```

Query the projection via API:

```bash
curl http://localhost:9123/api/v1/projections/order-stats
```

### 4. REWIND — Time Travel

The `recording: true` flag enables time-travel debugging. After a run completes:

```bash
# Copy the run ID from the server output, then:
./build/ironflow inspect <run_id>
```

The TUI debugger lets you scrub through every step, see inputs and outputs at each point in time. The dashboard at `http://localhost:9123` also provides a visual timeline.

## Running It

### 1. Build and start the Ironflow server

From the repository root:

```bash
make all                       # Build binary and dashboard
./build/ironflow serve --dev   # Start server at localhost:9123
```

### 2. Start the worker

In another terminal:

```bash
cd examples/quickstart
pnpm -C ../../sdk/js build   # Build the JS SDK (examples link to local packages)
pnpm install
pnpm tsx worker.ts
```

You should see:

```text
✓ Worker started — listening for events
  Functions:   process-order
  Projections: order-stats
```

### 3. Emit an event

```bash
ironflow emit order.placed --data '{"orderId":"ord-1","total":49.99,"email":"test@example.com"}'
```

### 4. Query the projection

```bash
curl http://localhost:9123/api/v1/projections/order-stats
```

### 5. Inspect the run

```bash
./build/ironflow inspect <run_id>
```

## Next Steps

- **[DDD Order Management](../ddd-order-management/)** — Learn how DDD patterns (aggregates, CQRS, sagas) organize the four pillars
- **[Go Quickstart](../go-quickstart/)** — The same Continuous History flow in Go
- **[Getting Started Tutorial](../../docs/tutorials/getting-started.mdx)** — Full walkthrough with more context
