package order

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/sahina/ironflow/sdk/go/ironflow"
	"github.com/sahina/ironflow/sdk/go/ironflow/ironflowtest"
)

const testOrderID = "0f3b6c1d9a4e47b28c5d1e6f70a2b3c4"

// fakeStreams is an order stream in memory. It records what was written so a
// test can assert the expected version and idempotency key the handler chose,
// which a mocked step would hide.
type fakeStreams struct {
	facts     []Fact
	appended  []AppendFact
	appendErr error
	// conflictOn makes the next append of this event name fail the optimistic
	// check, the way a concurrent writer would.
	conflictOn string
}

func (f *fakeStreams) Read(context.Context, string) ([]Fact, error) {
	return f.facts, nil
}

func (f *fakeStreams) Append(_ context.Context, _ string, fact AppendFact) (int64, error) {
	if f.appendErr != nil {
		return 0, f.appendErr
	}
	if fact.Name == f.conflictOn {
		return 0, ErrConflict
	}
	f.appended = append(f.appended, fact)
	version := int64(len(f.facts) + 1)
	data, err := toMap(fact.Data)
	if err != nil {
		return 0, err
	}
	f.facts = append(f.facts, Fact{
		Name:          fact.Name,
		Data:          data,
		Metadata:      fact.Metadata,
		EntityVersion: version,
	})
	return version, nil
}

func (f *fakeStreams) last(t *testing.T) AppendFact {
	t.Helper()
	if len(f.appended) == 0 {
		t.Fatal("nothing was appended")
	}
	return f.appended[len(f.appended)-1]
}

func testDeps(t *testing.T, streams *fakeStreams) Deps {
	t.Helper()
	return Deps{Streams: streams, Catalog: testCatalog(t), Now: func() time.Time { return testNow }}
}

func placedFact(t *testing.T) PlacedFact {
	t.Helper()
	fact, err := Price(placeCommandFromFixture(t, "fixtures/valid/place.order.json"), testCatalog(t), testNow)
	if err != nil {
		t.Fatalf("price: %v", err)
	}
	return fact
}

// ── Step bodies ─────────────────────────────────────────────────

func TestPlaceStepOpensTheStreamAtVersionZero(t *testing.T) {
	streams := &fakeStreams{}
	deps := testDeps(t, streams)

	result, err := deps.PlaceStep(context.Background(), placedFact(t), "evt-1", "8a1c2d3e4f5061728394a5b6c7d8e9f0")
	if err != nil {
		t.Fatalf("place: %v", err)
	}
	if result.Status != StatusPendingApproval || result.Skipped {
		t.Fatalf("result = %+v", result)
	}

	written := streams.last(t)
	if written.ExpectedVersion != 0 {
		t.Fatalf("expected version = %d, want 0", written.ExpectedVersion)
	}
	if written.IdempotencyKey != "place:"+testOrderID {
		t.Fatalf("idempotency key = %q", written.IdempotencyKey)
	}
	if written.Metadata["producer"] != Producer ||
		written.Metadata["correlationId"] != testOrderID ||
		written.Metadata["causationId"] != "evt-1" ||
		written.Metadata["demoSessionId"] != "8a1c2d3e4f5061728394a5b6c7d8e9f0" {
		t.Fatalf("metadata = %+v", written.Metadata)
	}
}

// A redelivered `place.order`, or a presenter's double-click, loses the
// optimistic check and must not fail the run or write a second fact.
func TestPlaceStepTreatsAConflictAsAlreadyPlaced(t *testing.T) {
	streams := &fakeStreams{conflictOn: EventOrderPlaced}
	deps := testDeps(t, streams)

	result, err := deps.PlaceStep(context.Background(), placedFact(t), "evt-1", "")
	if err != nil {
		t.Fatalf("place: %v", err)
	}
	if !result.Skipped {
		t.Fatal("a conflicting place was not reported as already placed")
	}
	if len(streams.appended) != 0 {
		t.Fatalf("appended %d facts after a conflict", len(streams.appended))
	}
}

func TestApproveStepWritesAtTheCurrentVersion(t *testing.T) {
	streams := &fakeStreams{facts: []Fact{placed(1)}}
	deps := testDeps(t, streams)

	if _, err := deps.ApproveStep(context.Background(), ApproveCommand{
		OrderID: testOrderID, ApprovedBy: "ops@example.com",
	}, "evt-2"); err != nil {
		t.Fatalf("approve: %v", err)
	}

	written := streams.last(t)
	if written.Name != EventOrderApproved || written.ExpectedVersion != 1 {
		t.Fatalf("append = %+v", written)
	}
	// The session comes off the placing fact, not off the operator's command.
	if written.Metadata["demoSessionId"] != "8a1c2d3e4f5061728394a5b6c7d8e9f0" {
		t.Fatalf("metadata = %+v", written.Metadata)
	}
}

func TestApproveStepIsANoOpOnRedelivery(t *testing.T) {
	streams := &fakeStreams{facts: []Fact{placed(1), fact(EventOrderApproved, 2, nil)}}
	deps := testDeps(t, streams)

	result, err := deps.ApproveStep(context.Background(), ApproveCommand{
		OrderID: testOrderID, ApprovedBy: "ops@example.com",
	}, "evt-2")
	if err != nil {
		t.Fatalf("approve: %v", err)
	}
	if !result.Skipped || len(streams.appended) != 0 {
		t.Fatalf("a redelivered approval wrote %d facts", len(streams.appended))
	}
}

func TestApproveStepRefusesANonPendingOrder(t *testing.T) {
	streams := &fakeStreams{facts: []Fact{
		placed(1), fact(EventOrderApproved, 2, nil), fact(EventOrderReleased, 3, nil), fact(EventOrderPaid, 4, nil),
	}}
	deps := testDeps(t, streams)

	// Terminal, and already approved — the approval guard reports the first
	// thing it finds; either way nothing is written.
	if _, err := deps.ApproveStep(context.Background(), ApproveCommand{
		OrderID: testOrderID, ApprovedBy: "ops@example.com",
	}, "evt-2"); err != nil && !IsAlreadyDone(err) {
		t.Fatalf("err = %v", err)
	}
	if len(streams.appended) != 0 {
		t.Fatal("a paid order was approved")
	}
}

func TestReleaseStepCarriesThePaymentInputs(t *testing.T) {
	streams := &fakeStreams{facts: []Fact{placed(1), fact(EventOrderApproved, 2, nil)}}
	deps := testDeps(t, streams)

	result, err := deps.ReleaseStep(context.Background(), testOrderID, "evt-3")
	if err != nil {
		t.Fatalf("release: %v", err)
	}
	if result.Status != StatusProcessingPayment || result.CustomerEmail != "ada@example.com" {
		t.Fatalf("result = %+v", result)
	}

	written := streams.last(t)
	if written.ExpectedVersion != 2 || written.IdempotencyKey != "release:"+testOrderID {
		t.Fatalf("append = %+v", written)
	}
	data, err := toMap(written.Data)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	// Payments never reads an order stream, so release has to carry these.
	if data["totalCents"] != float64(6900) || data["paymentMethodToken"] != "pm_success" {
		t.Fatalf("released data = %+v", data)
	}
}

func TestOutcomeStep(t *testing.T) {
	released := []Fact{placed(1), fact(EventOrderApproved, 2, nil), fact(EventOrderReleased, 3, nil)}

	t.Run("capture pays", func(t *testing.T) {
		streams := &fakeStreams{facts: append([]Fact(nil), released...)}
		deps := testDeps(t, streams)

		result, err := deps.OutcomeStep(context.Background(), EventPaymentCaptured, testOrderID, "evt-4",
			map[string]any{"orderId": testOrderID, "captureId": "cap_1"})
		if err != nil {
			t.Fatalf("outcome: %v", err)
		}
		if result.Status != StatusPaid {
			t.Fatalf("status = %q", result.Status)
		}
		written := streams.last(t)
		if written.Name != EventOrderPaid || written.ExpectedVersion != 3 {
			t.Fatalf("append = %+v", written)
		}
		if written.IdempotencyKey != "outcome:"+testOrderID {
			t.Fatalf("idempotency key = %q", written.IdempotencyKey)
		}
	})

	t.Run("decline fails", func(t *testing.T) {
		streams := &fakeStreams{facts: append([]Fact(nil), released...)}
		deps := testDeps(t, streams)

		result, err := deps.OutcomeStep(context.Background(), EventPaymentDeclined, testOrderID, "evt-4",
			map[string]any{"orderId": testOrderID, "reason": "insufficient funds"})
		if err != nil {
			t.Fatalf("outcome: %v", err)
		}
		if result.Status != StatusPaymentFailed || streams.last(t).Name != EventOrderPaymentFailed {
			t.Fatalf("result = %+v", result)
		}
	})

	// The same payment fact arriving twice, which JetStream permits.
	t.Run("a duplicate payment fact writes nothing", func(t *testing.T) {
		streams := &fakeStreams{facts: append(append([]Fact(nil), released...), fact(EventOrderPaid, 4, nil))}
		deps := testDeps(t, streams)

		result, err := deps.OutcomeStep(context.Background(), EventPaymentCaptured, testOrderID, "evt-4",
			map[string]any{"orderId": testOrderID, "captureId": "cap_1"})
		if err != nil {
			t.Fatalf("outcome: %v", err)
		}
		if !result.Skipped || len(streams.appended) != 0 {
			t.Fatalf("a duplicate capture wrote %d facts", len(streams.appended))
		}
	})

	// An authorization is a hold. Nothing here may turn one into `order.paid`.
	t.Run("an authorization pays nothing", func(t *testing.T) {
		streams := &fakeStreams{facts: append([]Fact(nil), released...)}
		deps := testDeps(t, streams)

		_, err := deps.OutcomeStep(context.Background(), EventPaymentAuthorized, testOrderID, "evt-4",
			map[string]any{"orderId": testOrderID, "authorizationId": "auth_1"})
		if !errors.Is(err, ErrUnknownOutcome) {
			t.Fatalf("err = %v", err)
		}
		if len(streams.appended) != 0 {
			t.Fatal("an authorization wrote an order fact")
		}
	})
}

// ── Choreography ────────────────────────────────────────────────

func testClient(t *testing.T, deps Deps) *ironflowtest.TestClient {
	t.Helper()
	return ironflowtest.NewClient(t, ironflowtest.Config{Functions: Functions(deps)})
}

func TestPlaceOrderRejectsAnUnpricedCommandBeforeAnyWrite(t *testing.T) {
	streams := &fakeStreams{}
	client := testClient(t, testDeps(t, streams))

	cmd := placeCommandFromFixture(t, "fixtures/invalid/domain/place.order.incorrect-total.json")
	run := client.Emit(t, "place.order", cmd)

	if run.Status != "failed" {
		t.Fatalf("status = %q, want failed", run.Status)
	}
	if len(streams.appended) != 0 {
		t.Fatal("a rejected command reached the stream")
	}
}

func TestPlaceOrderAnnouncesTheNewOrder(t *testing.T) {
	streams := &fakeStreams{}
	client := testClient(t, testDeps(t, streams))

	var published map[string]any
	client.MockStep(StepAppendPlaced, func() (any, error) {
		return StepResult{Status: StatusPendingApproval, CustomerEmail: "ada@example.com", OrderID: testOrderID}, nil
	})
	client.MockStep("publish:"+TopicOrderStatus, func() (any, error) {
		published = map[string]any{"called": true}
		return nil, nil
	})

	run := client.Emit(t, "place.order", placeCommandFromFixture(t, "fixtures/valid/place.order.json"))
	if run.Status != "completed" {
		t.Fatalf("status = %q: %v", run.Status, run.Error)
	}
	if published == nil {
		t.Fatal("no order-status notification was published")
	}
}

// A notification that cannot be published must not fail the order: delivery is
// never an order invariant.
func TestPublishFailureDoesNotFailTheOrder(t *testing.T) {
	client := testClient(t, testDeps(t, &fakeStreams{}))

	client.MockStep(StepAppendPlaced, func() (any, error) {
		return StepResult{Status: StatusPendingApproval, OrderID: testOrderID}, nil
	})
	client.MockStep("publish:"+TopicOrderStatus, func() (any, error) {
		return nil, errors.New("nats is down")
	})

	run := client.Emit(t, "place.order", placeCommandFromFixture(t, "fixtures/valid/place.order.json"))
	if run.Status != "completed" {
		t.Fatalf("a failed notification failed the order: %v", run.Error)
	}
}

func TestApprovalProcessWaitsThenReleases(t *testing.T) {
	client := testClient(t, testDeps(t, &fakeStreams{}))

	client.SendEvent(EventOrderApproved, map[string]any{"orderId": testOrderID})
	client.MockStep(StepAppendReleased, func() (any, error) {
		return StepResult{Status: StatusProcessingPayment, OrderID: testOrderID}, nil
	})
	client.MockStep("publish:"+TopicOrderStatus, func() (any, error) { return nil, nil })

	run := client.Emit(t, EventOrderPlaced, placedFact(t))
	if run.Status != "completed" {
		t.Fatalf("status = %q: %v", run.Status, run.Error)
	}

	var waited, released bool
	for _, step := range run.Steps {
		switch step.Name {
		case StepWaitApproval:
			waited = true
		case StepAppendReleased:
			released = true
		}
	}
	if !waited || !released {
		t.Fatalf("steps = %+v", run.Steps)
	}
}

func TestPaymentOutcomeNeedsAnOrderID(t *testing.T) {
	client := testClient(t, testDeps(t, &fakeStreams{}))

	run := client.Emit(t, EventPaymentCaptured, map[string]any{"captureId": "cap_1"})
	if run.Status != "failed" {
		t.Fatalf("a payment fact with no orderId completed: %+v", run)
	}
}

// The functions this service registers are the ones the plan names, and each
// one is a pull-mode worker function.
func TestRegisteredFunctions(t *testing.T) {
	functions := Functions(testDeps(t, &fakeStreams{}))

	want := map[string]bool{
		FnPlaceOrder: false, FnApproveOrder: false, FnApprovalProcess: false, FnPaymentOutcome: false,
	}
	for _, fn := range functions {
		if _, ok := want[fn.Config.ID]; !ok {
			t.Fatalf("unexpected function %q", fn.Config.ID)
		}
		want[fn.Config.ID] = true
		if fn.Config.Mode != ironflow.PullMode {
			t.Fatalf("%s is not a pull-mode function", fn.Config.ID)
		}
	}
	for id, found := range want {
		if !found {
			t.Fatalf("function %q was not registered", id)
		}
	}
}

// An append that fails for any reason other than a version conflict is a real
// failure: the step returns it, the run fails, and the engine retries.
func TestAnAppendFailureFailsTheStep(t *testing.T) {
	streams := &fakeStreams{appendErr: errors.New("engine unreachable")}
	deps := testDeps(t, streams)

	if _, err := deps.PlaceStep(context.Background(), placedFact(t), "evt-1", ""); err == nil {
		t.Fatal("a failed append was reported as success")
	}
}
