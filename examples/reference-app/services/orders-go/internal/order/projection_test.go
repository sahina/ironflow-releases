package order

import (
	"encoding/json"
	"testing"

	"github.com/sahina/ironflow/sdk/go/ironflow"
)

// reduce replays facts through the projection the way the engine does: state is
// deep-copied via JSON before every call, so every number arrives as a float64
// and no handler can keep a pointer into the previous state.
func reduce(t *testing.T, events ...ironflow.ProjectionEvent) map[string]any {
	t.Helper()
	projection := Projection()
	state := projection.Config.InitialState()

	for _, event := range events {
		encoded, err := json.Marshal(state)
		if err != nil {
			t.Fatalf("marshal state: %v", err)
		}
		var copied map[string]any
		if err := json.Unmarshal(encoded, &copied); err != nil {
			t.Fatalf("unmarshal state: %v", err)
		}
		state, err = projection.Config.Handler(copied, event, ironflow.ProjectionContext{})
		if err != nil {
			t.Fatalf("reduce %s: %v", event.Name, err)
		}
	}
	return state
}

func projected(t *testing.T, state map[string]any, orderID string) map[string]any {
	t.Helper()
	orders, ok := state["orders"].(map[string]any)
	if !ok {
		t.Fatalf("state has no orders map: %+v", state)
	}
	order, ok := orders[orderID].(map[string]any)
	if !ok {
		t.Fatalf("order %s is not in the read model: %+v", orderID, orders)
	}
	return order
}

func projectionEvent(name string, data map[string]any, producer string) ironflow.ProjectionEvent {
	if data["orderId"] == nil {
		data["orderId"] = testOrderID
	}
	event := ironflow.ProjectionEvent{
		ID:        "evt-" + name,
		Name:      name,
		Data:      data,
		Timestamp: "2026-03-04T05:06:07Z",
	}
	if producer != "" {
		event.Metadata = map[string]any{"producer": producer}
	}
	return event
}

func TestProjectionFollowsTheHappyPath(t *testing.T) {
	state := reduce(t,
		placedEvent(),
		projectionEvent(EventOrderApproved, map[string]any{"approvedBy": "ops@example.com"}, Producer),
		projectionEvent(EventOrderReleased, map[string]any{"releasedAt": "2026-03-04T05:07:00Z"}, Producer),
		projectionEvent(EventPaymentAuthorized, map[string]any{"authorizationId": "auth_1"}, "payments-node"),
		projectionEvent(EventPaymentCaptured, map[string]any{"authorizationId": "auth_1", "captureId": "cap_1"}, "payments-node"),
		projectionEvent(EventOrderPaid, map[string]any{"captureId": "cap_1", "paidAt": "2026-03-04T05:08:00Z"}, Producer),
		projectionEvent(EventNotificationSent, map[string]any{
			"messageId": testOrderID + ":paid", "status": "paid", "channel": "local-log", "sentAt": "2026-03-04T05:09:00Z",
		}, "notifications-python"),
	)

	order := projected(t, state, testOrderID)
	if order["status"] != string(StatusPaid) {
		t.Fatalf("status = %v", order["status"])
	}
	if order["captureId"] != "cap_1" || order["authorizationId"] != "auth_1" {
		t.Fatalf("payment facts missing: %+v", order)
	}
	if order["approvedBy"] != "ops@example.com" {
		t.Fatalf("approvedBy = %v", order["approvedBy"])
	}
	notification, ok := order["notification"].(map[string]any)
	if !ok || notification["status"] != "paid" {
		t.Fatalf("notification = %+v", order["notification"])
	}
	if order["demoSessionId"] != "8a1c2d3e4f5061728394a5b6c7d8e9f0" {
		t.Fatalf("demoSessionId = %v", order["demoSessionId"])
	}

	timeline, _ := order["timeline"].([]any)
	if len(timeline) != 7 {
		t.Fatalf("timeline has %d entries, want 7", len(timeline))
	}
	first, _ := timeline[0].(map[string]any)
	if first["producer"] != "web" || first["language"] != "TypeScript" {
		t.Fatalf("first timeline entry = %+v", first)
	}
	last, _ := timeline[len(timeline)-1].(map[string]any)
	if last["producer"] != "notifications-python" || last["language"] != "Python" {
		t.Fatalf("last timeline entry = %+v", last)
	}
}

func placedEvent() ironflow.ProjectionEvent {
	event := projectionEvent(EventOrderPlaced, map[string]any{
		"customerEmail":      "ada@example.com",
		"totalCents":         float64(6900),
		"currency":           "USD",
		"paymentMethodToken": "pm_success",
		"placedAt":           "2026-03-04T05:06:07Z",
		"items":              []any{map[string]any{"sku": "sku_desk_lamp", "quantity": float64(1)}},
	}, "web")
	event.Metadata["demoSessionId"] = "8a1c2d3e4f5061728394a5b6c7d8e9f0"
	return event
}

func TestProjectionFollowsTheDeclinePath(t *testing.T) {
	state := reduce(t,
		placedEvent(),
		projectionEvent(EventOrderApproved, map[string]any{"approvedBy": "ops@example.com"}, Producer),
		projectionEvent(EventOrderReleased, map[string]any{}, Producer),
		projectionEvent(EventPaymentDeclined, map[string]any{"reason": "insufficient funds"}, "payments-node"),
		projectionEvent(EventOrderPaymentFailed, map[string]any{"reason": "insufficient funds", "failedAt": "2026-03-04T05:08:00Z"}, Producer),
	)

	order := projected(t, state, testOrderID)
	if order["status"] != string(StatusPaymentFailed) {
		t.Fatalf("status = %v", order["status"])
	}
	if order["failureReason"] != "insufficient funds" || order["declineReason"] != "insufficient funds" {
		t.Fatalf("order = %+v", order)
	}
}

// An authorization is a hold. It appears in the read model without moving the
// order out of processing_payment.
func TestAuthorizationDoesNotPayTheOrder(t *testing.T) {
	state := reduce(t,
		placedEvent(),
		projectionEvent(EventOrderApproved, map[string]any{"approvedBy": "ops@example.com"}, Producer),
		projectionEvent(EventOrderReleased, map[string]any{}, Producer),
		projectionEvent(EventPaymentAuthorized, map[string]any{"authorizationId": "auth_1"}, "payments-node"),
	)

	order := projected(t, state, testOrderID)
	if order["status"] != string(StatusProcessingPayment) {
		t.Fatalf("status = %v, want processing_payment", order["status"])
	}
	if order["authorizationId"] != "auth_1" {
		t.Fatalf("the authorization is missing from the read model: %+v", order)
	}
}

func TestProjectionKeepsOrdersApart(t *testing.T) {
	other := projectionEvent(EventOrderPlaced, map[string]any{
		"orderId": "11111111111111111111111111111111", "customerEmail": "grace@example.com",
	}, "web")

	state := reduce(t, placedEvent(), other)

	if projected(t, state, testOrderID)["customerEmail"] != "ada@example.com" {
		t.Fatal("orders bled into each other")
	}
	if projected(t, state, "11111111111111111111111111111111")["customerEmail"] != "grace@example.com" {
		t.Fatal("the second order is missing")
	}
}

func TestProjectionIgnoresAFactWithNoOrder(t *testing.T) {
	state := reduce(t, ironflow.ProjectionEvent{
		Name: EventPaymentCaptured,
		Data: map[string]any{"captureId": "cap_1"},
	})

	orders, _ := state["orders"].(map[string]any)
	if len(orders) != 0 {
		t.Fatalf("orders = %+v", orders)
	}
}

// The projection subscribes to exactly the facts the UI renders. `place.order`
// and `approve.order` are commands and must not be in the list.
func TestProjectionSubscribesToFactsOnly(t *testing.T) {
	for _, name := range Projection().Config.Events {
		switch name {
		case "place.order", "approve.order", "demo.payment.continue":
			t.Fatalf("the read model subscribes to the command %q", name)
		}
	}
	if Projection().Config.Mode != ironflow.ProjectionModeManaged {
		t.Fatal("the order read model is not a managed projection")
	}
}
