package main

// The load gate advertises a real optimistic-concurrency conflict. Normal
// duplicate commands can run serially, or the entity append's idempotency key
// can return the first result, and neither path exercises the retry. This
// load-only Streams decorator parks both selected approval appends after their
// reads, then gives the two command attempts distinct probe keys. Both writes
// therefore reach the expected-version check with the same stream version.

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"github.com/sahina/ironflow/examples/reference-app/services/orders-go/internal/order"
)

const (
	approvalConflictOrdersEnv = "REFERENCE_APP_APPROVAL_CONFLICT_ORDERS"
	orderMaxConcurrentJobsEnv = "REFERENCE_APP_ORDER_MAX_CONCURRENT_JOBS"
)

type approvalConflictProbe struct {
	next    order.Streams
	logf    func(string, ...any)
	targets map[string]struct{}

	mu      sync.Mutex
	waiting map[string]chan struct{}
}

func newApprovalConflictProbe(next order.Streams, orderIDs string, logf func(string, ...any)) order.Streams {
	targets := make(map[string]struct{})
	for _, id := range strings.Split(orderIDs, ",") {
		if id = strings.TrimSpace(id); id != "" {
			targets[id] = struct{}{}
		}
	}
	return &approvalConflictProbe{
		next:    next,
		logf:    logf,
		targets: targets,
		waiting: make(map[string]chan struct{}),
	}
}

func (p *approvalConflictProbe) Read(ctx context.Context, orderID string) ([]order.Fact, error) {
	return p.next.Read(ctx, orderID)
}

func (p *approvalConflictProbe) Append(ctx context.Context, orderID string, fact order.AppendFact) (int64, error) {
	if fact.Name != order.EventOrderApproved || !p.isTarget(orderID) {
		return p.next.Append(ctx, orderID, fact)
	}
	if err := p.meet(ctx, orderID); err != nil {
		return 0, err
	}

	// Production uses one operation key per order. The probe needs each
	// concurrent command to reach the expected-version check instead of taking
	// the engine's idempotent fast path. The command event id is stable across
	// that run's retries, so this remains idempotent within an attempt.
	fact.IdempotencyKey += ":probe:" + fmt.Sprint(fact.Metadata["causationId"])
	version, err := p.next.Append(ctx, orderID, fact)
	if order.IsConflict(err) && p.logf != nil {
		p.logf("load approval conflict observed: order=%s", orderID)
	}
	return version, err
}

func (p *approvalConflictProbe) isTarget(orderID string) bool {
	_, ok := p.targets[orderID]
	return ok
}

// meet releases a pair only after both handlers have completed their stream
// reads and reached Append. The load gate raises worker concurrency above the
// number of possible first arrivals, so a waiting half cannot occupy every job
// slot and starve its partner.
func (p *approvalConflictProbe) meet(ctx context.Context, orderID string) error {
	p.mu.Lock()
	if partner, ok := p.waiting[orderID]; ok {
		delete(p.waiting, orderID)
		close(partner)
		p.mu.Unlock()
		return nil
	}
	ready := make(chan struct{})
	p.waiting[orderID] = ready
	p.mu.Unlock()

	select {
	case <-ready:
		return nil
	case <-ctx.Done():
		p.mu.Lock()
		if p.waiting[orderID] == ready {
			delete(p.waiting, orderID)
		}
		p.mu.Unlock()
		return ctx.Err()
	}
}
