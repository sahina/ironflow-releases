// Command orders is the Ordering context of the reference app.
//
// It is a pull-mode Ironflow worker: it polls the engine for work, so it needs
// no inbound port and no HTTP API of its own. The supervisor
// (examples/reference-app/scripts/dev.mjs) starts it with IRONFLOW_URL and
// IRONFLOW_API_KEY already pointing at the engine it just booted.
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strconv"
	"syscall"

	"github.com/sahina/ironflow/examples/reference-app/services/orders-go/internal/order"
	"github.com/sahina/ironflow/sdk/go/ironflow"
)

// ownedSchemas are the messages this context publishes. Registering them is
// what makes the engine enforce the shared contract on every append: a fact
// that drifts from contracts/schemas/ is refused at ingest, not discovered in
// the UI. Payments and Notifications register their own.
var ownedSchemas = []string{
	order.EventOrderPlaced,
	order.EventOrderApproved,
	order.EventOrderReleased,
	order.EventOrderPaid,
	order.EventOrderPaymentFailed,
	order.TopicOrderStatus,
}

func main() {
	log.SetPrefix("")
	log.SetFlags(0)

	if err := run(); err != nil {
		log.Fatalf("orders: %v", err)
	}
}

func run() error {
	contractsDir, err := order.FindContractsDir()
	if err != nil {
		return err
	}
	catalog, err := order.LoadCatalog(contractsDir)
	if err != nil {
		return err
	}

	client := ironflow.NewClient(ironflow.ClientConfig{})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Registration comes before the worker starts, so the first order cannot
	// race an unregistered schema.
	if err := registerSchemas(ctx, client, contractsDir); err != nil {
		return err
	}

	streams := order.Streams(order.NewStreams(client))
	if targets := os.Getenv(approvalConflictOrdersEnv); targets != "" {
		streams = newApprovalConflictProbe(streams, targets, log.Printf)
	}
	maxConcurrentJobs, err := orderWorkerConcurrency(os.Getenv(orderMaxConcurrentJobsEnv))
	if err != nil {
		return err
	}
	deps := order.Deps{Streams: streams, Catalog: catalog}
	worker := ironflow.NewWorker(ironflow.WorkerConfig{
		Functions:         order.Functions(deps),
		Projections:       []ironflow.Projection{order.Projection()},
		MaxConcurrentJobs: maxConcurrentJobs,
	})

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-signals
		log.Println("stopping")
		cancel()
		worker.Drain()
	}()

	log.Printf("ordering ready — %d products, %d schemas registered", len(catalog.Products), len(ownedSchemas))
	return worker.Run(ctx)
}

func orderWorkerConcurrency(raw string) (int, error) {
	if raw == "" {
		return 0, nil // SDK default
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return 0, fmt.Errorf("%s must be a positive integer, got %q", orderMaxConcurrentJobsEnv, raw)
	}
	return value, nil
}

// registerSchemas is idempotent: re-registering the same version with the same
// document is an upsert, so a restart is free.
func registerSchemas(ctx context.Context, client *ironflow.Client, contractsDir string) error {
	for _, name := range ownedSchemas {
		schema, err := order.LoadDataSchema(contractsDir, name+".v1.schema.json")
		if err != nil {
			return fmt.Errorf("load schema for %s: %w", name, err)
		}
		if _, err := client.Schemas().Register(ctx, ironflow.RegisterSchemaInput{
			Name:    name,
			Version: 1,
			Schema:  schema,
		}); err != nil {
			return fmt.Errorf("register schema for %s: %w", name, err)
		}
	}
	return nil
}
