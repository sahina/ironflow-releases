package order

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

var testNow = time.Date(2026, 3, 4, 5, 6, 7, 0, time.UTC)

func testCatalog(t *testing.T) *Catalog {
	t.Helper()
	catalog, err := LoadCatalog(contractsDir(t))
	if err != nil {
		t.Fatalf("load catalog: %v", err)
	}
	return catalog
}

// placeCommandFromFixture reads the `data` half of a fixture into the command
// this service actually receives. Fixtures are read in place, never copied.
func placeCommandFromFixture(t *testing.T, rel string) PlaceCommand {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(contractsDir(t), rel))
	if err != nil {
		t.Fatalf("read %s: %v", rel, err)
	}
	var envelope struct {
		Data PlaceCommand `json:"data"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		t.Fatalf("parse %s: %v", rel, err)
	}
	return envelope.Data
}

func TestPricePricesFromTheCatalog(t *testing.T) {
	cmd := placeCommandFromFixture(t, "fixtures/valid/place.order.json")

	fact, err := Price(cmd, testCatalog(t), testNow)
	if err != nil {
		t.Fatalf("price: %v", err)
	}
	// One desk lamp (4500) plus two notebooks (2 x 1200).
	if fact.TotalCents != 6900 {
		t.Fatalf("total = %d, want 6900", fact.TotalCents)
	}
	if len(fact.Items) != 2 {
		t.Fatalf("items = %d, want 2", len(fact.Items))
	}
	if fact.Items[1].UnitPriceCents != 1200 || fact.Items[1].LineTotalCents != 2400 {
		t.Fatalf("notebook line priced wrong: %+v", fact.Items[1])
	}
	if fact.PlacedAt != "2026-03-04T05:06:07Z" {
		t.Fatalf("placedAt = %q", fact.PlacedAt)
	}
}

// The two `invalid/domain/` fixtures exist precisely because no schema can
// reject them. This is the only place in the system that can.
func TestPriceRejectsTheDomainInvalidFixtures(t *testing.T) {
	cases := map[string]error{
		"fixtures/invalid/domain/place.order.unknown-catalog-item.json": ErrUnknownItem,
		"fixtures/invalid/domain/place.order.incorrect-total.json":      ErrTotalMismatch,
	}
	for fixture, want := range cases {
		t.Run(filepath.Base(fixture), func(t *testing.T) {
			_, err := Price(placeCommandFromFixture(t, fixture), testCatalog(t), testNow)
			if !errors.Is(err, want) {
				t.Fatalf("err = %v, want %v", err, want)
			}
		})
	}
}

func TestPriceRejectsMalformedCommands(t *testing.T) {
	valid := placeCommandFromFixture(t, "fixtures/valid/place.order.json")

	cases := []struct {
		name string
		edit func(*PlaceCommand)
		want error
	}{
		{"no order id", func(c *PlaceCommand) { c.OrderID = "" }, ErrMissingOrderID},
		{"no items", func(c *PlaceCommand) { c.Items = nil }, ErrEmptyItems},
		{"not usd", func(c *PlaceCommand) { c.Currency = "EUR" }, ErrCurrency},
		{"no email", func(c *PlaceCommand) { c.CustomerEmail = "" }, ErrMissingRequired},
		{"zero quantity", func(c *PlaceCommand) { c.Items[0].Quantity = 0 }, ErrInvalidQuantity},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cmd := valid
			cmd.Items = append([]CommandItem(nil), valid.Items...)
			tc.edit(&cmd)
			if _, err := Price(cmd, testCatalog(t), testNow); !errors.Is(err, tc.want) {
				t.Fatalf("err = %v, want %v", err, tc.want)
			}
		})
	}
}

func placed(version int64) Fact {
	return Fact{
		Name:          EventOrderPlaced,
		EntityVersion: version,
		Data: map[string]any{
			"orderId":            "0f3b6c1d9a4e47b28c5d1e6f70a2b3c4",
			"customerEmail":      "ada@example.com",
			"totalCents":         float64(6900),
			"currency":           "USD",
			"paymentMethodToken": "pm_success",
		},
		Metadata: map[string]any{"demoSessionId": "8a1c2d3e4f5061728394a5b6c7d8e9f0", "producer": "web"},
	}
}

func fact(name string, version int64, data map[string]any) Fact {
	if data == nil {
		data = map[string]any{"orderId": "0f3b6c1d9a4e47b28c5d1e6f70a2b3c4"}
	}
	return Fact{Name: name, EntityVersion: version, Data: data}
}

func TestFold(t *testing.T) {
	cases := []struct {
		name   string
		facts  []Fact
		status Status
		checks func(*testing.T, State)
	}{
		{
			name:   "empty stream",
			facts:  nil,
			status: "",
			checks: func(t *testing.T, s State) {
				if s.Exists {
					t.Fatal("an empty stream folded to an existing order")
				}
			},
		},
		{
			name:   "placed",
			facts:  []Fact{placed(1)},
			status: StatusPendingApproval,
			checks: func(t *testing.T, s State) {
				if s.Version != 1 || s.TotalCents != 6900 || s.PaymentMethodToken != "pm_success" {
					t.Fatalf("state = %+v", s)
				}
				if s.DemoSessionID != "8a1c2d3e4f5061728394a5b6c7d8e9f0" {
					t.Fatalf("demo session = %q", s.DemoSessionID)
				}
			},
		},
		{
			name:   "approved but not released",
			facts:  []Fact{placed(1), fact(EventOrderApproved, 2, nil)},
			status: StatusPendingApproval,
			checks: func(t *testing.T, s State) {
				if !s.Approved || s.Released {
					t.Fatalf("state = %+v", s)
				}
			},
		},
		{
			name:   "released",
			facts:  []Fact{placed(1), fact(EventOrderApproved, 2, nil), fact(EventOrderReleased, 3, nil)},
			status: StatusProcessingPayment,
			checks: func(t *testing.T, s State) {
				if !s.Released || s.Version != 3 {
					t.Fatalf("state = %+v", s)
				}
			},
		},
		{
			name: "paid",
			facts: []Fact{
				placed(1), fact(EventOrderApproved, 2, nil), fact(EventOrderReleased, 3, nil), fact(EventOrderPaid, 4, nil),
			},
			status: StatusPaid,
			checks: func(t *testing.T, s State) {
				if !s.Terminal() {
					t.Fatal("a paid order is not terminal")
				}
			},
		},
		{
			name: "payment failed",
			facts: []Fact{
				placed(1), fact(EventOrderApproved, 2, nil), fact(EventOrderReleased, 3, nil), fact(EventOrderPaymentFailed, 4, nil),
			},
			status: StatusPaymentFailed,
			checks: func(t *testing.T, s State) {
				if !s.Terminal() {
					t.Fatal("a failed order is not terminal")
				}
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			state := Fold(tc.facts)
			if state.Status != tc.status {
				t.Fatalf("status = %q, want %q", state.Status, tc.status)
			}
			tc.checks(t, state)
		})
	}
}

// A later fact from another service must not move the order between demo
// session filters.
func TestFoldKeepsThePlacingSession(t *testing.T) {
	stolen := fact(EventOrderApproved, 2, nil)
	stolen.Metadata = map[string]any{"demoSessionId": "ffffffffffffffffffffffffffffffff"}

	state := Fold([]Fact{placed(1), stolen})
	if state.DemoSessionID != "8a1c2d3e4f5061728394a5b6c7d8e9f0" {
		t.Fatalf("demo session = %q", state.DemoSessionID)
	}
}

func TestDecideApprove(t *testing.T) {
	cmd := ApproveCommand{OrderID: "0f3b6c1d9a4e47b28c5d1e6f70a2b3c4", ApprovedBy: "ops@example.com"}

	t.Run("pending order", func(t *testing.T) {
		data, err := DecideApprove(Fold([]Fact{placed(1)}), cmd, testNow)
		if err != nil {
			t.Fatalf("approve: %v", err)
		}
		if data["approvedBy"] != "ops@example.com" || data["approvedAt"] != "2026-03-04T05:06:07Z" {
			t.Fatalf("data = %+v", data)
		}
	})

	t.Run("unknown order", func(t *testing.T) {
		if _, err := DecideApprove(State{}, cmd, testNow); !errors.Is(err, ErrNotFound) {
			t.Fatalf("err = %v", err)
		}
	})

	t.Run("already approved", func(t *testing.T) {
		state := Fold([]Fact{placed(1), fact(EventOrderApproved, 2, nil)})
		if _, err := DecideApprove(state, cmd, testNow); !errors.Is(err, ErrAlreadyApproved) {
			t.Fatalf("err = %v", err)
		}
	})

	t.Run("terminal order", func(t *testing.T) {
		state := Fold([]Fact{placed(1), fact(EventOrderPaid, 2, nil)})
		if _, err := DecideApprove(state, cmd, testNow); !errors.Is(err, ErrNotPending) {
			t.Fatalf("err = %v", err)
		}
	})

	t.Run("no approver", func(t *testing.T) {
		state := Fold([]Fact{placed(1)})
		if _, err := DecideApprove(state, ApproveCommand{OrderID: cmd.OrderID}, testNow); !errors.Is(err, ErrMissingRequired) {
			t.Fatalf("err = %v", err)
		}
	})
}

func TestDecideRelease(t *testing.T) {
	t.Run("approved order", func(t *testing.T) {
		state := Fold([]Fact{placed(1), fact(EventOrderApproved, 2, nil)})
		data, err := DecideRelease(state, testNow)
		if err != nil {
			t.Fatalf("release: %v", err)
		}
		// Payments never reads an order stream, so release carries what it needs.
		if data["totalCents"] != int64(6900) || data["paymentMethodToken"] != "pm_success" {
			t.Fatalf("data = %+v", data)
		}
	})

	t.Run("not approved", func(t *testing.T) {
		if _, err := DecideRelease(Fold([]Fact{placed(1)}), testNow); !errors.Is(err, ErrNotPending) {
			t.Fatalf("err = %v", err)
		}
	})

	t.Run("already released", func(t *testing.T) {
		state := Fold([]Fact{placed(1), fact(EventOrderApproved, 2, nil), fact(EventOrderReleased, 3, nil)})
		if _, err := DecideRelease(state, testNow); !errors.Is(err, ErrAlreadyReleased) {
			t.Fatalf("err = %v", err)
		}
	})
}

func releasedState() State {
	return Fold([]Fact{placed(1), fact(EventOrderApproved, 2, nil), fact(EventOrderReleased, 3, nil)})
}

func TestDecidePaymentOutcome(t *testing.T) {
	t.Run("capture pays the order", func(t *testing.T) {
		name, status, data, err := DecidePaymentOutcome(releasedState(), EventPaymentCaptured,
			map[string]any{"captureId": "cap_1"}, testNow)
		if err != nil {
			t.Fatalf("outcome: %v", err)
		}
		if name != EventOrderPaid || status != StatusPaid {
			t.Fatalf("name = %q, status = %q", name, status)
		}
		if data["captureId"] != "cap_1" || data["totalCents"] != int64(6900) {
			t.Fatalf("data = %+v", data)
		}
	})

	// The invariant with the sharpest teeth: an authorization is a hold, and no
	// branch here turns one into `order.paid`.
	t.Run("authorization alone pays nothing", func(t *testing.T) {
		_, _, _, err := DecidePaymentOutcome(releasedState(), EventPaymentAuthorized,
			map[string]any{"authorizationId": "auth_1"}, testNow)
		if !errors.Is(err, ErrUnknownOutcome) {
			t.Fatalf("err = %v", err)
		}
	})

	t.Run("decline fails the order", func(t *testing.T) {
		name, status, data, err := DecidePaymentOutcome(releasedState(), EventPaymentDeclined,
			map[string]any{"reason": "insufficient funds"}, testNow)
		if err != nil {
			t.Fatalf("outcome: %v", err)
		}
		if name != EventOrderPaymentFailed || status != StatusPaymentFailed || data["reason"] != "insufficient funds" {
			t.Fatalf("name = %q status = %q data = %+v", name, status, data)
		}
	})

	// A redelivered payment fact, or a second attempt after a decline.
	t.Run("a terminal order is done", func(t *testing.T) {
		state := Fold([]Fact{
			placed(1), fact(EventOrderApproved, 2, nil), fact(EventOrderReleased, 3, nil), fact(EventOrderPaid, 4, nil),
		})
		_, _, _, err := DecidePaymentOutcome(state, EventPaymentCaptured, map[string]any{"captureId": "cap_1"}, testNow)
		if !errors.Is(err, ErrAlreadyTerminal) || !IsAlreadyDone(err) {
			t.Fatalf("err = %v", err)
		}
	})

	t.Run("payment before release", func(t *testing.T) {
		_, _, _, err := DecidePaymentOutcome(Fold([]Fact{placed(1)}), EventPaymentCaptured,
			map[string]any{"captureId": "cap_1"}, testNow)
		if !errors.Is(err, ErrNotReleased) {
			t.Fatalf("err = %v", err)
		}
	})

	t.Run("capture without a capture id", func(t *testing.T) {
		_, _, _, err := DecidePaymentOutcome(releasedState(), EventPaymentCaptured, map[string]any{}, testNow)
		if !errors.Is(err, ErrMissingRequired) {
			t.Fatalf("err = %v", err)
		}
	})
}

// Python deduplicates on messageId, so the same order and status must always
// produce the same one.
func TestNotificationMessageIDIsStable(t *testing.T) {
	state := releasedState()
	first := NotificationMessage(state.OrderID, state.CustomerEmail, StatusPaid, testNow)
	second := NotificationMessage(state.OrderID, state.CustomerEmail, StatusPaid, testNow.Add(time.Hour))

	if first["messageId"] != second["messageId"] {
		t.Fatalf("message ids differ: %v vs %v", first["messageId"], second["messageId"])
	}
	if first["messageId"] != state.OrderID+":paid" {
		t.Fatalf("messageId = %v", first["messageId"])
	}
	if first["customerEmail"] != "ada@example.com" {
		t.Fatalf("customerEmail = %v", first["customerEmail"])
	}
}
