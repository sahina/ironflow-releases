package order

// The four Ordering functions. Each one is thin on purpose: parse the event,
// ask the domain what should happen, and write the answer inside one durable
// step. The decisions live in model.go, the writes in streams.go.
//
// Every step body is a method on Deps rather than a closure, so a test can call
// the write path directly with a fake Streams and see the expected version, the
// idempotency key and the metadata it really used.

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/sahina/ironflow/sdk/go/ironflow"
)

// ApprovalWaitTimeout bounds the durable approval wait. An order nobody
// approves does not hold a run open forever.
const ApprovalWaitTimeout = 7 * 24 * time.Hour

// Function IDs, also the labels the operations UI shows.
const (
	FnPlaceOrder      = "place-order"
	FnApproveOrder    = "approve-order"
	FnApprovalProcess = "order-approval-process"
	FnPaymentOutcome  = "record-payment-outcome"
)

// Step names. The live crash test reads them off a run, so they are constants.
const (
	StepAppendPlaced   = "append-order-placed"
	StepAppendApproved = "append-order-approved"
	StepWaitApproval   = "wait-approval"
	StepAppendReleased = "append-order-released"
	StepAppendOutcome  = "append-order-outcome"
)

// Deps is what the handlers need from outside the domain.
type Deps struct {
	Streams Streams
	Catalog *Catalog
	// Now is injectable so tests get deterministic timestamps.
	Now func() time.Time
}

func (d Deps) now() time.Time {
	if d.Now == nil {
		return time.Now()
	}
	return d.Now()
}

// StepResult is what every write step returns. Carrying the customer-facing
// status and email means the notification publish needs no second read, and a
// resumed run replays them from the memoized step.
type StepResult struct {
	Status        Status `json:"status"`
	CustomerEmail string `json:"customerEmail"`
	OrderID       string `json:"orderId"`
	Version       int64  `json:"version"`
	// Skipped means "announce nothing". Usually that is because the fact was
	// already on the stream, so nothing was written; ApproveStep also sets it
	// after a real write, because approval is not a customer-facing state
	// change.
	Skipped bool `json:"skipped"`
}

// Functions returns every function this service registers, in the order the
// story happens.
func Functions(deps Deps) []ironflow.Function {
	return []ironflow.Function{
		placeOrder(deps),
		approveOrder(deps),
		approvalProcess(deps),
		paymentOutcome(deps),
	}
}

// ── Step bodies ─────────────────────────────────────────────────

// PlaceStep opens the order stream. Expected version 0 is the "placed once"
// invariant: a second command for the same orderId finds a stream that exists.
func (d Deps) PlaceStep(ctx context.Context, fact PlacedFact, causationID, session string) (StepResult, error) {
	version, err := d.Streams.Append(ctx, fact.OrderID, AppendFact{
		Name:            EventOrderPlaced,
		Data:            fact,
		ExpectedVersion: 0,
		IdempotencyKey:  "place:" + fact.OrderID,
		Metadata:        FactMetadata(fact.OrderID, causationID, session),
	})
	if IsConflict(err) {
		return StepResult{OrderID: fact.OrderID, Skipped: true}, nil
	}
	if err != nil {
		return StepResult{}, err
	}
	return StepResult{
		Status:        StatusPendingApproval,
		CustomerEmail: fact.CustomerEmail,
		OrderID:       fact.OrderID,
		Version:       version,
	}, nil
}

// ApproveStep records the operator decision.
//
// Read, decide and append are one step. Splitting them would let the stream
// move between the version this read and the version it writes against.
func (d Deps) ApproveStep(ctx context.Context, cmd ApproveCommand, causationID string) (StepResult, error) {
	state, err := d.state(ctx, cmd.OrderID)
	if err != nil {
		return StepResult{}, err
	}
	data, err := DecideApprove(state, cmd, d.now())
	if IsAlreadyDone(err) {
		return StepResult{OrderID: cmd.OrderID, Skipped: true}, nil
	}
	if err != nil {
		return StepResult{}, err
	}
	version, err := d.Streams.Append(ctx, cmd.OrderID, AppendFact{
		Name:            EventOrderApproved,
		Data:            data,
		ExpectedVersion: state.Version,
		IdempotencyKey:  "approve:" + cmd.OrderID,
		Metadata:        FactMetadata(cmd.OrderID, causationID, state.DemoSessionID),
	})
	if err != nil {
		return StepResult{}, err
	}
	// Approval is not a customer-facing state change: the order stays pending
	// until the durable wait releases it, so this announces nothing.
	return StepResult{OrderID: cmd.OrderID, Version: version, Skipped: true}, nil
}

// ReleaseStep ends the approval wait and lets payment start.
func (d Deps) ReleaseStep(ctx context.Context, orderID, causationID string) (StepResult, error) {
	state, err := d.state(ctx, orderID)
	if err != nil {
		return StepResult{}, err
	}
	data, err := DecideRelease(state, d.now())
	if IsAlreadyDone(err) {
		return StepResult{OrderID: orderID, Skipped: true}, nil
	}
	if err != nil {
		return StepResult{}, err
	}
	version, err := d.Streams.Append(ctx, orderID, AppendFact{
		Name:            EventOrderReleased,
		Data:            data,
		ExpectedVersion: state.Version,
		IdempotencyKey:  "release:" + orderID,
		Metadata:        FactMetadata(orderID, causationID, state.DemoSessionID),
	})
	if err != nil {
		return StepResult{}, err
	}
	return StepResult{
		Status:        StatusProcessingPayment,
		CustomerEmail: state.CustomerEmail,
		OrderID:       orderID,
		Version:       version,
	}, nil
}

// OutcomeStep closes the order on a payment fact from the Payments context.
func (d Deps) OutcomeStep(ctx context.Context, eventName, orderID, causationID string, payment map[string]any) (StepResult, error) {
	state, err := d.state(ctx, orderID)
	if err != nil {
		return StepResult{}, err
	}
	name, status, data, err := DecidePaymentOutcome(state, eventName, payment, d.now())
	if IsAlreadyDone(err) {
		return StepResult{OrderID: orderID, Skipped: true}, nil
	}
	if err != nil {
		return StepResult{}, err
	}
	version, err := d.Streams.Append(ctx, orderID, AppendFact{
		Name:            name,
		Data:            data,
		ExpectedVersion: state.Version,
		// One payment attempt per order, so one key for either outcome.
		IdempotencyKey: "outcome:" + orderID,
		Metadata:       FactMetadata(orderID, causationID, state.DemoSessionID),
	})
	if err != nil {
		return StepResult{}, err
	}
	return StepResult{
		Status:        status,
		CustomerEmail: state.CustomerEmail,
		OrderID:       orderID,
		Version:       version,
	}, nil
}

func (d Deps) state(ctx context.Context, orderID string) (State, error) {
	facts, err := d.Streams.Read(ctx, orderID)
	if err != nil {
		return State{}, err
	}
	return Fold(facts), nil
}

// ── Functions ───────────────────────────────────────────────────

// placeOrder validates a `place.order` command against the committed catalog
// and opens the order stream with it.
func placeOrder(deps Deps) ironflow.Function {
	return ironflow.CreateFunction(
		ironflow.FunctionConfig{
			ID:        FnPlaceOrder,
			Name:      "Place order",
			Mode:      ironflow.PullMode,
			Recording: true,
			Triggers:  []ironflow.Trigger{{Event: "place.order"}},
		},
		func(ctx ironflow.Context) (any, error) {
			var cmd PlaceCommand
			if err := ctx.Event.Data(&cmd); err != nil {
				return nil, fmt.Errorf("parse place.order: %w", err)
			}
			// The catalog is the authority. A total the browser got wrong, or a
			// SKU that is not on sale, is refused here and nowhere else.
			fact, err := Price(cmd, deps.Catalog, deps.now())
			if err != nil {
				return nil, fmt.Errorf("reject place.order: %w", err)
			}
			session := DemoSessionOf(ctx.Event.Metadata)

			result, err := ironflow.Run(ctx, StepAppendPlaced, func() (StepResult, error) {
				return deps.PlaceStep(ctx.RunContext(), fact, ctx.Event.ID, session)
			})
			if err != nil {
				return nil, err
			}
			announce(ctx, deps, result)
			return result, nil
		},
	)
}

// approveOrder is the operator decision. Only a pending order can be approved.
func approveOrder(deps Deps) ironflow.Function {
	return ironflow.CreateFunction(
		ironflow.FunctionConfig{
			ID:        FnApproveOrder,
			Name:      "Approve order",
			Mode:      ironflow.PullMode,
			Recording: true,
			Triggers:  []ironflow.Trigger{{Event: "approve.order"}},
		},
		func(ctx ironflow.Context) (any, error) {
			var cmd ApproveCommand
			if err := ctx.Event.Data(&cmd); err != nil {
				return nil, fmt.Errorf("parse approve.order: %w", err)
			}
			return ironflow.Run(ctx, StepAppendApproved, func() (StepResult, error) {
				return deps.ApproveStep(ctx.RunContext(), cmd, ctx.Event.ID)
			})
		},
	)
}

// approvalProcess is the process manager. It starts when an order is placed and
// parks on a durable wait until that order is approved — the run survives a
// restart of this service, and of the engine.
func approvalProcess(deps Deps) ironflow.Function {
	return ironflow.CreateFunction(
		ironflow.FunctionConfig{
			ID:        FnApprovalProcess,
			Name:      "Await approval",
			Mode:      ironflow.PullMode,
			Recording: true,
			Triggers:  []ironflow.Trigger{{Event: EventOrderPlaced}},
		},
		func(ctx ironflow.Context) (any, error) {
			var placed PlacedFact
			if err := ctx.Event.Data(&placed); err != nil {
				return nil, fmt.Errorf("parse order.placed: %w", err)
			}

			// Match on data.orderId: the engine compares this run's triggering
			// event with each incoming order.approved, so one waiting run
			// belongs to exactly one order.
			if _, err := ironflow.WaitForEvent[map[string]any](ctx, StepWaitApproval, ironflow.EventFilter{
				Event:   EventOrderApproved,
				Match:   "data.orderId",
				Timeout: ApprovalWaitTimeout,
			}); err != nil {
				return nil, fmt.Errorf("wait for approval: %w", err)
			}

			result, err := ironflow.Run(ctx, StepAppendReleased, func() (StepResult, error) {
				return deps.ReleaseStep(ctx.RunContext(), placed.OrderID, ctx.Event.ID)
			})
			if err != nil {
				return nil, err
			}
			announce(ctx, deps, result)
			return result, nil
		},
	)
}

// paymentOutcome closes the order on a payment fact. One function for both
// outcomes: the terminal-state guard is the same, and the domain decides which
// fact follows which.
func paymentOutcome(deps Deps) ironflow.Function {
	return ironflow.CreateFunction(
		ironflow.FunctionConfig{
			ID:        FnPaymentOutcome,
			Name:      "Record payment outcome",
			Mode:      ironflow.PullMode,
			Recording: true,
			Triggers: []ironflow.Trigger{
				{Event: EventPaymentCaptured},
				{Event: EventPaymentDeclined},
			},
		},
		func(ctx ironflow.Context) (any, error) {
			var payment map[string]any
			if err := ctx.Event.Data(&payment); err != nil {
				return nil, fmt.Errorf("parse %s: %w", ctx.Event.Name, err)
			}
			orderID, _ := payment["orderId"].(string)
			if orderID == "" {
				return nil, fmt.Errorf("%s carries no orderId", ctx.Event.Name)
			}

			result, err := ironflow.Run(ctx, StepAppendOutcome, func() (StepResult, error) {
				return deps.OutcomeStep(ctx.RunContext(), ctx.Event.Name, orderID, ctx.Event.ID, payment)
			})
			if err != nil {
				return nil, err
			}
			announce(ctx, deps, result)
			return result, nil
		},
	)
}

// announce publishes the order status for the Notifications context.
//
// Its error is logged and dropped on purpose. Publishing a notification is not
// an order invariant: an order that is paid stays paid whether or not anyone
// hears about it.
func announce(ctx ironflow.Context, deps Deps, result StepResult) {
	if result.Skipped || result.Status == "" {
		return
	}
	message := NotificationMessage(result.OrderID, result.CustomerEmail, result.Status, deps.now())
	if err := ironflow.Publish(ctx, TopicOrderStatus, message); err != nil {
		log.Printf("order %s: publishing the %s notification failed, order state is unaffected: %v",
			result.OrderID, result.Status, err)
	}
}
