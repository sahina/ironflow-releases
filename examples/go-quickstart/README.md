# Go Quickstart: Continuous History in 5 Minutes

This example builds a simple order processing system in ~100 lines of Go that demonstrates all four pillars of **Continuous History**: emit, react, derive, and rewind.

## What is Continuous History?

Record every change as an immutable event. React with durable workflows. Derive read models automatically. Rewind to any moment for debugging. One system, not four.

## What This Example Builds

A Go worker that:

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

The `ProcessOrder` function triggers on `order.placed` and runs three memoized steps. If the process crashes mid-way, it resumes from the last completed step — not from the beginning.

```go
// main.go — lines 25-64
var ProcessOrder = ironflow.CreateFunction(
    ironflow.FunctionConfig{
        ID: "process-order", Mode: ironflow.PullMode,
        Recording: true,
        Triggers:  []ironflow.Trigger{{Event: "order.placed"}},
    },
    func(ctx ironflow.Context) (any, error) {
        order, err := ironflow.Run(ctx, "validate-order", func() (map[string]any, error) { ... })
        payment, err := ironflow.Run(ctx, "process-payment", func() (map[string]any, error) { ... })
        _, err = ironflow.Run(ctx, "send-confirmation", func() (map[string]any, error) { ... })
        return map[string]any{"order": order, "payment": payment}, nil
    },
)
```

Each `ironflow.Run()` call is memoized: on retry, completed steps return their cached result instantly.

### 3. DERIVE — Projections

The `OrderStats` projection is a pure reducer that builds a read model from the event stream. No manual queries — the projection stays consistent automatically.

```go
// main.go — lines 69-88
var OrderStats = ironflow.CreateProjection(ironflow.ProjectionConfig{
    Name:   "order-stats",
    Events: []string{"order.placed"},
    InitialState: func() map[string]any {
        return map[string]any{"totalOrders": 0, "totalRevenue": 0.0}
    },
    Handler: func(state map[string]any, event ironflow.ProjectionEvent, ctx ironflow.ProjectionContext) (map[string]any, error) {
        total, _ := event.Data["total"].(float64)
        totalOrders, _ := state["totalOrders"].(int)
        totalRevenue, _ := state["totalRevenue"].(float64)
        return map[string]any{
            "totalOrders":  totalOrders + 1,
            "totalRevenue": totalRevenue + total,
        }, nil
    },
})
```

Query the projection via API:

```bash
curl http://localhost:9123/api/v1/projections/order-stats
```

### 4. REWIND — Time Travel

The `Recording: true` flag enables time-travel debugging. After a run completes:

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

### 2. Build and run the worker

```bash
cd examples/go-quickstart
go run main.go
```

You should see:

```text
Worker started - listening for events
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

- **[Quickstart (TypeScript)](../quickstart/)** — The same Continuous History flow in TypeScript
- **[DDD Order Management](../ddd-order-management/)** — Learn how DDD patterns (aggregates, CQRS, sagas) organize the four pillars
- **[Getting Started Tutorial](../../docs/tutorials/getting-started.mdx)** — Full walkthrough with more context
