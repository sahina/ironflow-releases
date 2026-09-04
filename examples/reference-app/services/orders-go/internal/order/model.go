package order

// The Ordering domain, with no Ironflow types in sight. Everything here is a
// pure function of a command, the committed catalog and the folded stream, so
// every invariant in ../../CONTEXT.md is testable without a server.

import (
	"errors"
	"fmt"
	"time"
)

// Status is a customer-facing order state. There are exactly four; authorization,
// capture and notification delivery are facts in the timeline, not states.
type Status string

const (
	StatusPendingApproval   Status = "pending_approval"
	StatusProcessingPayment Status = "processing_payment"
	StatusPaid              Status = "paid"
	StatusPaymentFailed     Status = "payment_failed"
)

// Event names this context reads or writes.
const (
	EventOrderPlaced        = "order.placed"
	EventOrderApproved      = "order.approved"
	EventOrderReleased      = "order.released"
	EventOrderPaid          = "order.paid"
	EventOrderPaymentFailed = "order.payment_failed"

	EventPaymentAuthorized = "payment.authorized"
	EventPaymentCaptured   = "payment.captured"
	EventPaymentDeclined   = "payment.declined"

	EventNotificationSent = "notification.sent"

	TopicOrderStatus = "notifications.order-status"

	// Producer is the value this service writes into every fact's metadata.
	Producer = "orders-go"

	// EntityType is the entity type of every `order-{orderId}` stream.
	EntityType = "order"
)

// Domain errors. The handlers turn some of these into a successful no-op — a
// re-delivered command must not fail — and let the rest fail the run.
var (
	// ErrAlreadyPlaced, ErrAlreadyApproved, ErrAlreadyReleased and
	// ErrAlreadyTerminal all mean "this already happened": the outcome the
	// caller asked for is the outcome on the stream.
	ErrAlreadyPlaced   = errors.New("order already placed")
	ErrAlreadyApproved = errors.New("order already approved")
	ErrAlreadyReleased = errors.New("order already released")
	ErrAlreadyTerminal = errors.New("order already reached a terminal state")
	ErrNotFound        = errors.New("order not found")
	ErrNotPending      = errors.New("only a pending order can be approved")
	ErrNotReleased     = errors.New("payment facts require a released order")
	ErrEmptyItems      = errors.New("an order needs at least one item")
	ErrUnknownItem     = errors.New("item is not in the committed catalog")
	ErrTotalMismatch   = errors.New("total disagrees with the catalog")
	ErrCurrency        = errors.New("currency must be USD")
	ErrUnknownOutcome  = errors.New("unknown payment outcome")
	ErrMissingOrderID  = errors.New("orderId is required")
	ErrInvalidQuantity = errors.New("quantity must be at least 1")
	ErrMissingRequired = errors.New("required field is missing")
)

// IsAlreadyDone reports whether an error means the requested outcome is already
// recorded. Handlers treat these as success so a redelivery is a no-op.
func IsAlreadyDone(err error) bool {
	return errors.Is(err, ErrAlreadyPlaced) ||
		errors.Is(err, ErrAlreadyApproved) ||
		errors.Is(err, ErrAlreadyReleased) ||
		errors.Is(err, ErrAlreadyTerminal)
}

// CommandItem is one requested line of a `place.order` command.
type CommandItem struct {
	SKU      string `json:"sku"`
	Quantity int    `json:"quantity"`
}

// PlaceCommand is the `place.order` payload.
type PlaceCommand struct {
	OrderID            string        `json:"orderId"`
	CustomerEmail      string        `json:"customerEmail"`
	Items              []CommandItem `json:"items"`
	TotalCents         int64         `json:"totalCents"`
	Currency           string        `json:"currency"`
	PaymentMethodToken string        `json:"paymentMethodToken"`
}

// ApproveCommand is the `approve.order` payload.
type ApproveCommand struct {
	OrderID    string `json:"orderId"`
	ApprovedBy string `json:"approvedBy"`
}

// PricedItem is one line of an `order.placed` fact, priced from the catalog.
type PricedItem struct {
	SKU            string `json:"sku"`
	Quantity       int    `json:"quantity"`
	UnitPriceCents int64  `json:"unitPriceCents"`
	LineTotalCents int64  `json:"lineTotalCents"`
}

// PlacedFact is the `order.placed` payload.
type PlacedFact struct {
	OrderID            string       `json:"orderId"`
	CustomerEmail      string       `json:"customerEmail"`
	Items              []PricedItem `json:"items"`
	TotalCents         int64        `json:"totalCents"`
	Currency           string       `json:"currency"`
	PaymentMethodToken string       `json:"paymentMethodToken"`
	PlacedAt           string       `json:"placedAt"`
}

// Fact is one event on an order stream, reduced to what folding needs. Keeping
// the SDK's StreamEvent out of this file is what lets the whole domain be
// tested without a client.
type Fact struct {
	Name          string
	Data          map[string]any
	Metadata      map[string]any
	EntityVersion int64
}

// State is the folded order. Version is the entity version of the last event,
// which is the expected version of the next append.
type State struct {
	Exists             bool
	OrderID            string
	Version            int64
	Status             Status
	CustomerEmail      string
	TotalCents         int64
	Currency           string
	PaymentMethodToken string
	DemoSessionID      string
	Approved           bool
	Released           bool
}

// Terminal reports whether the order has finished, one way or the other.
func (s State) Terminal() bool {
	return s.Status == StatusPaid || s.Status == StatusPaymentFailed
}

// Fold replays an order stream into current state.
func Fold(facts []Fact) State {
	var state State
	for _, fact := range facts {
		state.Exists = true
		state.Version = fact.EntityVersion
		if id, ok := fact.Data["orderId"].(string); ok && id != "" {
			state.OrderID = id
		}
		switch fact.Name {
		case EventOrderPlaced:
			state.Status = StatusPendingApproval
			state.CustomerEmail, _ = fact.Data["customerEmail"].(string)
			state.Currency, _ = fact.Data["currency"].(string)
			state.PaymentMethodToken, _ = fact.Data["paymentMethodToken"].(string)
			state.TotalCents = asCents(fact.Data["totalCents"])
			// The demo session is set once, by the customer who placed the
			// order. Later facts come from other services and other sessions
			// must not be able to move an order between filters.
			if session, ok := fact.Metadata["demoSessionId"].(string); ok {
				state.DemoSessionID = session
			}
		case EventOrderApproved:
			state.Approved = true
		case EventOrderReleased:
			state.Released = true
			state.Status = StatusProcessingPayment
		case EventOrderPaid:
			state.Status = StatusPaid
		case EventOrderPaymentFailed:
			state.Status = StatusPaymentFailed
		}
	}
	return state
}

// Price validates a `place.order` command against the committed catalog and
// returns the `order.placed` fact to append. The browser's total is a display
// value: this is where the catalog price wins.
func Price(cmd PlaceCommand, catalog *Catalog, now time.Time) (PlacedFact, error) {
	if cmd.OrderID == "" {
		return PlacedFact{}, ErrMissingOrderID
	}
	if cmd.CustomerEmail == "" || cmd.PaymentMethodToken == "" {
		return PlacedFact{}, ErrMissingRequired
	}
	if cmd.Currency != catalog.Currency {
		return PlacedFact{}, fmt.Errorf("%w: got %q", ErrCurrency, cmd.Currency)
	}
	if len(cmd.Items) == 0 {
		return PlacedFact{}, ErrEmptyItems
	}

	items := make([]PricedItem, 0, len(cmd.Items))
	var total int64
	for _, item := range cmd.Items {
		if item.Quantity < 1 {
			return PlacedFact{}, fmt.Errorf("%w: %s", ErrInvalidQuantity, item.SKU)
		}
		product, ok := catalog.Lookup(item.SKU)
		if !ok {
			return PlacedFact{}, fmt.Errorf("%w: %s", ErrUnknownItem, item.SKU)
		}
		line := product.UnitPriceCents * int64(item.Quantity)
		total += line
		items = append(items, PricedItem{
			SKU:            item.SKU,
			Quantity:       item.Quantity,
			UnitPriceCents: product.UnitPriceCents,
			LineTotalCents: line,
		})
	}
	if cmd.TotalCents != total {
		return PlacedFact{}, fmt.Errorf("%w: command says %d, catalog says %d", ErrTotalMismatch, cmd.TotalCents, total)
	}

	return PlacedFact{
		OrderID:            cmd.OrderID,
		CustomerEmail:      cmd.CustomerEmail,
		Items:              items,
		TotalCents:         total,
		Currency:           cmd.Currency,
		PaymentMethodToken: cmd.PaymentMethodToken,
		PlacedAt:           Timestamp(now),
	}, nil
}

// DecideApprove enforces approval rules and returns the `order.approved` payload.
func DecideApprove(state State, cmd ApproveCommand, now time.Time) (map[string]any, error) {
	switch {
	case !state.Exists:
		return nil, ErrNotFound
	case state.Approved:
		return nil, ErrAlreadyApproved
	case state.Status != StatusPendingApproval:
		return nil, fmt.Errorf("%w: order is %s", ErrNotPending, state.Status)
	case cmd.ApprovedBy == "":
		return nil, ErrMissingRequired
	}
	return map[string]any{
		"orderId":    state.OrderID,
		"approvedBy": cmd.ApprovedBy,
		"approvedAt": Timestamp(now),
	}, nil
}

// DecideRelease returns the `order.released` payload once approval has landed.
// Release carries the total and token forward so Payments never reads an order
// stream it does not own.
func DecideRelease(state State, now time.Time) (map[string]any, error) {
	switch {
	case !state.Exists:
		return nil, ErrNotFound
	case state.Released:
		return nil, ErrAlreadyReleased
	case !state.Approved:
		return nil, ErrNotPending
	}
	return map[string]any{
		"orderId":            state.OrderID,
		"totalCents":         state.TotalCents,
		"currency":           state.Currency,
		"paymentMethodToken": state.PaymentMethodToken,
		"releasedAt":         Timestamp(now),
	}, nil
}

// DecidePaymentOutcome turns a payment fact into the order fact that follows it.
//
// This is where "`order.paid` can follow only `payment.captured`" lives: an
// authorization is a hold, it reaches no branch here, and the only path to
// StatusPaid is the capture case.
func DecidePaymentOutcome(state State, eventName string, payment map[string]any, now time.Time) (string, Status, map[string]any, error) {
	switch {
	case !state.Exists:
		return "", "", nil, ErrNotFound
	case state.Terminal():
		// One payment attempt per order, and a decline is final.
		return "", "", nil, ErrAlreadyTerminal
	case !state.Released:
		return "", "", nil, ErrNotReleased
	}

	switch eventName {
	case EventPaymentCaptured:
		captureID, _ := payment["captureId"].(string)
		if captureID == "" {
			return "", "", nil, fmt.Errorf("%w: captureId", ErrMissingRequired)
		}
		return EventOrderPaid, StatusPaid, map[string]any{
			"orderId":    state.OrderID,
			"captureId":  captureID,
			"totalCents": state.TotalCents,
			"currency":   state.Currency,
			"paidAt":     Timestamp(now),
		}, nil
	case EventPaymentDeclined:
		reason, _ := payment["reason"].(string)
		if reason == "" {
			reason = "declined by the gateway"
		}
		return EventOrderPaymentFailed, StatusPaymentFailed, map[string]any{
			"orderId":  state.OrderID,
			"reason":   reason,
			"failedAt": Timestamp(now),
		}, nil
	default:
		return "", "", nil, fmt.Errorf("%w: %s", ErrUnknownOutcome, eventName)
	}
}

// NotificationMessage is the `notifications.order-status` payload. messageId is
// derived from the order and the status it announces, never from process-local
// randomness, so a redelivery reuses the same ID and the Python subscriber can
// deduplicate it.
func NotificationMessage(orderID, customerEmail string, status Status, now time.Time) map[string]any {
	return map[string]any{
		"messageId":     orderID + ":" + string(status),
		"orderId":       orderID,
		"status":        string(status),
		"customerEmail": customerEmail,
		"occurredAt":    Timestamp(now),
	}
}

// Timestamp formats a time the way every contract schema expects.
func Timestamp(t time.Time) string {
	return t.UTC().Format(time.RFC3339)
}

// StreamID is the entity ID of an order's stream.
func StreamID(orderID string) string {
	return "order-" + orderID
}

// asCents reads an integer amount that may have arrived as a JSON number.
func asCents(value any) int64 {
	switch typed := value.(type) {
	case float64:
		return int64(typed)
	case int64:
		return typed
	case int:
		return int64(typed)
	default:
		return 0
	}
}
