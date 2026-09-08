# Go SDK Reference

## Install

```bash
go get github.com/sahina/ironflow-go/ironflow
```

## Event Name Constants

```go
package events

const (
    OrderPlaced    = "order.placed"
    OrderConfirmed = "order.confirmed"
    OrderShipped   = "order.shipped"
)
```

## Functions

```go
import (
    "github.com/sahina/ironflow-go/ironflow"
    "your-module/internal/events"
)

var ProcessOrder = ironflow.CreateFunction(ironflow.FunctionConfig{
    ID:        "process-order",
    Triggers:  []ironflow.Trigger{{Event: events.OrderPlaced}},
    Recording: true,
}, func(ctx ironflow.Context) (any, error) {
    var data OrderData
    if err := ctx.Event.Data(&data); err != nil {
        return nil, err
    }

    order, err := ironflow.Run(ctx, "validate", func() (Order, error) {
        return Order{Valid: true, OrderID: data.OrderID}, nil
    })
    if err != nil {
        return nil, err
    }

    return map[string]any{"order": order}, nil
})
```

## Step Methods

```go
// Memoized — generic, infers return type
result, err := ironflow.Run(ctx, "step-name", func() (MyType, error) {
    return MyType{Done: true}, nil
})

// With timeout override
result, err := ironflow.Run(ctx, "slow", func() (string, error) {
    return callAPI()
}, ironflow.WithTimeout(30*time.Second))

// Durable sleep
ironflow.Sleep(ctx, "wait", 1*time.Hour)
ironflow.SleepUntil(ctx, "wait-open", time.Date(2026, 3, 16, 9, 30, 0, 0, time.UTC))

// Wait for event. The type argument is REQUIRED — T appears in no parameter,
// so Go cannot infer it and the call does not compile without it.
// On timeout the scheduler fails the run; err is not how a timeout reaches you.
event, err := ironflow.WaitForEvent[any](ctx, "wait-approval", ironflow.EventFilter{
    Event:   events.OrderApproved,
    Match:   "data.orderId",
    Timeout: 24 * time.Hour,   // default 7 days
})

// Parallel branches
results, err := ironflow.Parallel(ctx, "fetch-all", []func(*ironflow.BranchContext) (any, error){
    func(b *ironflow.BranchContext) (any, error) { return fetchA() },
    func(b *ironflow.BranchContext) (any, error) { return fetchB() },
})

// Parallel map with concurrency
results, err := ironflow.Map(ctx, "items", items, func(item Item, b *ironflow.BranchContext, i int) (Result, error) {
    return processItem(item)
}, ironflow.ParallelOptions{Concurrency: 5})

// Saga compensation
ironflow.Compensate(ctx, "charge", func() error { return refund() })

// Invoke another function
result, err := ironflow.Invoke[InvoiceResult](ctx, "generate-invoice", input)
asyncRes, err := ironflow.InvokeAsync(ctx, "send-report", input)

// NEVER recover() around a yielding step. Sleep, SleepUntil, WaitForEvent,
// Invoke and InvokeAsync suspend the run by PANICKING with an internal yield
// value (sdk/go/ironflow/step.go). A recover() in your handler swallows it and
// the run finishes without ever waiting. Only Run returns ordinary errors.

// Pub/sub publish
ironflow.Publish(ctx, "notifications", data)
```

## Projections

```go
var OrderStats = ironflow.CreateProjection(ironflow.ProjectionConfig{
    Name:   "order-stats",
    Events: []string{events.OrderPlaced},
    InitialState: func() map[string]any {
        // Use float64 literals so the .(float64) assertion below is stable
        // both on first call (in-memory) and on rebuild (unmarshaled from JSON).
        return map[string]any{"totalOrders": 0.0, "revenue": 0.0}
    },
    Handler: func(state map[string]any, event ironflow.ProjectionEvent, ctx ironflow.ProjectionContext) (map[string]any, error) {
        // Return a fresh map — never mutate `state` then return it. See anti-patterns.md #3b.
        next := make(map[string]any, len(state)+1)
        for k, v := range state {
            next[k] = v
        }
        next["totalOrders"] = state["totalOrders"].(float64) + 1
        return next, nil
    },
})
```

## Worker (Pull Mode)

```go
worker := ironflow.NewWorker(ironflow.WorkerConfig{
    ServerURL:   os.Getenv("IRONFLOW_SERVER_URL"),
    Functions:   []ironflow.Function{ProcessOrder},
    Projections: []ironflow.Projection{OrderStats},
})
worker.Run(ctx)   // automatically registers all functions
```

## Serve (Push Mode — HTTP Handler)

```go
handler := ironflow.Serve(ironflow.ServeConfig{
    Functions: []ironflow.Function{ProcessOrder},
})
http.ListenAndServe(":3001", handler)
```

## Upcasters

`UpcasterFunc` is `func(json.RawMessage) (json.RawMessage, error)` — raw JSON in, raw
JSON out, with an error. It is not a `map[string]any` transform.

```go
registry := ironflow.NewUpcasterRegistry()

registry.Register("user.created", 1, 2, func(data json.RawMessage) (json.RawMessage, error) {
    var m map[string]any
    if err := json.Unmarshal(data, &m); err != nil {
        return nil, err
    }
    firstName, _ := m["firstName"].(string)
    lastName, _ := m["lastName"].(string)
    delete(m, "firstName")
    delete(m, "lastName")
    m["fullName"] = firstName + " " + lastName   // every other field is preserved
    return json.Marshal(m)
})
```

---

## Full Reference

- Go SDK reference: https://docs.ironflow.run/reference/sdk-comparison/
- Workflows guide: https://docs.ironflow.run/explanation/workflows/
- Event sourcing: https://docs.ironflow.run/explanation/event-sourcing/
