package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/sahina/ironflow/sdk/go/ironflow"
)

// ── Types ───────────────────────────────────────────────────────

type OrderData struct {
	OrderID string  `json:"orderId"`
	Total   float64 `json:"total"`
	Email   string  `json:"email"`
}

// ── React: A function that processes orders ─────────────────────
// Every step is memoized and permanently recorded.
// If the process crashes, it resumes from the last completed step.
var ProcessOrder = ironflow.CreateFunction(
	ironflow.FunctionConfig{
		ID:        "process-order",
		Name:      "Process Order",
		Mode:      ironflow.PullMode,
		Recording: true,
		Triggers: []ironflow.Trigger{
			{Event: "order.placed"},
		},
	},
	func(ctx ironflow.Context) (any, error) {
		var data OrderData
		if err := ctx.Event.Data(&data); err != nil {
			return nil, fmt.Errorf("failed to parse order data: %w", err)
		}

		order, err := ironflow.Run(ctx, "validate-order", func() (map[string]any, error) {
			return map[string]any{"valid": true, "orderId": data.OrderID, "total": data.Total}, nil
		})
		if err != nil {
			return nil, err
		}

		payment, err := ironflow.Run(ctx, "process-payment", func() (map[string]any, error) {
			return map[string]any{"charged": true, "amount": data.Total, "transactionId": fmt.Sprintf("txn_%s", data.OrderID)}, nil
		})
		if err != nil {
			return nil, err
		}

		_, err = ironflow.Run(ctx, "send-confirmation", func() (map[string]any, error) {
			return map[string]any{"sent": true, "email": data.Email}, nil
		})
		if err != nil {
			return nil, err
		}

		return map[string]any{"order": order, "payment": payment}, nil
	},
)

// ── Derive: A projection that computes order statistics ─────────
// Pure reducer: receives current state + event, returns new state.
// No manual queries — the projection stays consistent automatically.
var OrderStats = ironflow.CreateProjection(ironflow.ProjectionConfig{
	Name:   "order-stats",
	Events: []string{"order.placed"},
	Mode:   ironflow.ProjectionModeManaged,
	InitialState: func() map[string]any {
		return map[string]any{"totalOrders": 0, "totalRevenue": 0.0}
	},
	Handler: func(state map[string]any, event ironflow.ProjectionEvent, ctx ironflow.ProjectionContext) (map[string]any, error) {
		total, ok := event.Data["total"].(float64)
		if !ok {
			return state, fmt.Errorf("event data missing 'total' field")
		}
		totalOrders, _ := state["totalOrders"].(int)
		totalRevenue, _ := state["totalRevenue"].(float64)
		return map[string]any{
			"totalOrders":  totalOrders + 1,
			"totalRevenue": totalRevenue + total,
		}, nil
	},
})

func main() {
	worker := ironflow.NewWorker(ironflow.WorkerConfig{
		Functions:   []ironflow.Function{ProcessOrder},
		Projections: []ironflow.Projection{OrderStats},
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigChan
		log.Println("Shutting down...")
		cancel()
		worker.Drain()
	}()

	log.Println("Worker started - listening for events")
	log.Println("  Functions:   process-order")
	log.Println("  Projections: order-stats")

	if err := worker.Run(ctx); err != nil {
		log.Fatalf("Worker error: %v", err)
	}
}
