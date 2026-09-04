package order

// The read model the web application renders. It is a managed projection: a
// pure reducer over the facts, with the engine owning storage, replay and
// catch-up. The browser reads and subscribes to it and never folds a raw
// stream itself.

import (
	"strings"

	"github.com/sahina/ironflow/sdk/go/ironflow"
)

// ProjectionName is the projection the shop and operations pages read.
const ProjectionName = "orders"

// The projection is deliberately not partitioned. The operations page needs the
// whole queue, and the browser SDK can read and subscribe to a projection but
// cannot enumerate its partitions — so a partitioned projection would leave the
// UI unable to list orders at all.
//
// ponytail: one state document holding every order. Demo scale is a handful of
// orders; partition by orderId if the browser ever grows a partition listing.
func Projection() ironflow.Projection {
	return ironflow.CreateProjection(ironflow.ProjectionConfig{
		Name: ProjectionName,
		Events: []string{
			EventOrderPlaced, EventOrderApproved, EventOrderReleased,
			EventOrderPaid, EventOrderPaymentFailed,
			EventPaymentAuthorized, EventPaymentCaptured, EventPaymentDeclined,
			EventNotificationSent,
		},
		Mode:         ironflow.ProjectionModeManaged,
		InitialState: func() map[string]any { return map[string]any{"orders": map[string]any{}} },
		Handler: func(state map[string]any, event ironflow.ProjectionEvent, _ ironflow.ProjectionContext) (map[string]any, error) {
			orderID, _ := event.Data["orderId"].(string)
			if orderID == "" {
				// Not an order fact this read model can place. Dropping it keeps
				// the projection moving rather than stalling on a retry loop.
				return state, nil
			}

			orders, ok := state["orders"].(map[string]any)
			if !ok {
				orders = map[string]any{}
				state["orders"] = orders
			}
			order, ok := orders[orderID].(map[string]any)
			if !ok {
				order = map[string]any{"orderId": orderID}
			}

			applyFact(order, event)
			order["timeline"] = appendTimeline(order["timeline"], event)
			order["updatedAt"] = event.Timestamp
			orders[orderID] = order
			return state, nil
		},
	})
}

// applyFact writes the facts the UI shows. Only the five `order.*` facts move
// the status: an authorization is a hold, and a notification is a record of
// delivery, so neither is a customer-facing state.
func applyFact(order map[string]any, event ironflow.ProjectionEvent) {
	data := event.Data

	switch event.Name {
	case EventOrderPlaced:
		order["status"] = string(StatusPendingApproval)
		copyFields(order, data, "customerEmail", "items", "totalCents", "currency", "paymentMethodToken")
		order["placedAt"] = data["placedAt"]
		// The demo session filter comes off the placing customer's metadata and
		// is never overwritten by a later producer.
		if session := DemoSessionOf(event.Metadata); session != "" {
			order["demoSessionId"] = session
		}
	case EventOrderApproved:
		copyFields(order, data, "approvedBy", "approvedAt")
	case EventOrderReleased:
		order["status"] = string(StatusProcessingPayment)
		order["releasedAt"] = data["releasedAt"]
	case EventOrderPaid:
		order["status"] = string(StatusPaid)
		copyFields(order, data, "captureId", "paidAt")
	case EventOrderPaymentFailed:
		order["status"] = string(StatusPaymentFailed)
		order["failureReason"] = data["reason"]
		order["failedAt"] = data["failedAt"]
	case EventPaymentAuthorized:
		copyFields(order, data, "authorizationId", "authorizedAt")
	case EventPaymentCaptured:
		copyFields(order, data, "authorizationId", "captureId", "capturedAt")
	case EventPaymentDeclined:
		order["declineReason"] = data["reason"]
	case EventNotificationSent:
		order["notification"] = map[string]any{
			"messageId": data["messageId"],
			"status":    data["status"],
			"channel":   data["channel"],
			"sentAt":    data["sentAt"],
		}
	}
}

// appendTimeline records every fact in arrival order, with the service and
// language that produced it, which is what the collapsed timeline in the UI
// renders.
func appendTimeline(existing any, event ironflow.ProjectionEvent) []any {
	entries, _ := existing.([]any)
	return append(entries, map[string]any{
		"event":    event.Name,
		"producer": producerOf(event),
		"language": languageOf(producerOf(event)),
		"at":       event.Timestamp,
		"eventId":  event.ID,
	})
}

func producerOf(event ironflow.ProjectionEvent) string {
	if producer, ok := event.Metadata["producer"].(string); ok && producer != "" {
		return producer
	}
	// A fact with no metadata is still placeable: only one context writes each
	// family of facts.
	switch {
	case event.Name == EventNotificationSent:
		return "notifications-python"
	case strings.HasPrefix(event.Name, "payment."):
		return "payments-node"
	default:
		return Producer
	}
}

func languageOf(producer string) string {
	switch producer {
	case "orders-go":
		return "Go"
	case "payments-node":
		return "TypeScript"
	case "notifications-python":
		return "Python"
	case "web":
		return "TypeScript"
	default:
		return ""
	}
}

func copyFields(order, data map[string]any, fields ...string) {
	for _, field := range fields {
		if value, ok := data[field]; ok {
			order[field] = value
		}
	}
}
