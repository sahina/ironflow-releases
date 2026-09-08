package main

import (
	"context"
	"sync"
	"testing"

	"github.com/sahina/ironflow/examples/reference-app/services/orders-go/internal/order"
)

type probeStreams struct {
	mu       sync.Mutex
	version  int64
	appended []order.AppendFact
}

func (s *probeStreams) Read(context.Context, string) ([]order.Fact, error) { return nil, nil }

func (s *probeStreams) Append(_ context.Context, _ string, fact order.AppendFact) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if fact.ExpectedVersion != s.version {
		return 0, order.ErrConflict
	}
	s.version++
	s.appended = append(s.appended, fact)
	return s.version, nil
}

func TestApprovalConflictProbeForcesOneVersionConflict(t *testing.T) {
	const orderID = "order-probe"
	next := &probeStreams{version: 1}
	var logMu sync.Mutex
	var logs []string
	streams := newApprovalConflictProbe(next, orderID, func(format string, args ...any) {
		logMu.Lock()
		defer logMu.Unlock()
		logs = append(logs, format)
	})

	results := make(chan error, 2)
	for _, eventID := range []string{"command-1", "command-2"} {
		go func() {
			_, err := streams.Append(context.Background(), orderID, order.AppendFact{
				Name:            order.EventOrderApproved,
				ExpectedVersion: 1,
				IdempotencyKey:  "approve:" + orderID,
				Metadata:        map[string]any{"causationId": eventID},
			})
			results <- err
		}()
	}

	conflicts := 0
	for range 2 {
		if order.IsConflict(<-results) {
			conflicts++
		}
	}
	if conflicts != 1 {
		t.Fatalf("conflicts = %d, want 1", conflicts)
	}
	if len(next.appended) != 1 {
		t.Fatalf("appended = %d, want 1", len(next.appended))
	}
	if next.appended[0].IdempotencyKey == "approve:"+orderID {
		t.Fatal("probe append kept the production idempotency key")
	}
	if len(logs) != 1 {
		t.Fatalf("conflict logs = %d, want 1", len(logs))
	}
}

func TestApprovalConflictProbeLeavesOtherAppendsAlone(t *testing.T) {
	next := &probeStreams{version: 1}
	streams := newApprovalConflictProbe(next, "target", nil)
	fact := order.AppendFact{
		Name:            order.EventOrderApproved,
		ExpectedVersion: 1,
		IdempotencyKey:  "approve:other",
	}

	if _, err := streams.Append(context.Background(), "other", fact); err != nil {
		t.Fatalf("append: %v", err)
	}
	if next.appended[0].IdempotencyKey != fact.IdempotencyKey {
		t.Fatalf("idempotency key = %q, want %q", next.appended[0].IdempotencyKey, fact.IdempotencyKey)
	}
}

func TestOrderWorkerConcurrency(t *testing.T) {
	if got, err := orderWorkerConcurrency(""); err != nil || got != 0 {
		t.Fatalf("default = %d, %v", got, err)
	}
	if got, err := orderWorkerConcurrency("21"); err != nil || got != 21 {
		t.Fatalf("configured = %d, %v", got, err)
	}
	if _, err := orderWorkerConcurrency("nope"); err == nil {
		t.Fatal("invalid concurrency was accepted")
	}
}
