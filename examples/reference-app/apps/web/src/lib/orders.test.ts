import { describe, expect, test } from "vitest";

import {
  awaitingPresenterRelease,
  inPayment,
  type OrdersProjection,
  ordersForSession,
  paymentStage,
  pendingApprovals,
  producerLabel,
  type ProjectedOrder,
} from "@/lib/orders";

// The shape the browser SDK hands back: `getProjection` peels the envelope down
// to the reducer's own state, which is what the Go projection writes.
const projection: OrdersProjection = {
  orders: {
    mine: {
      orderId: "mine",
      status: "pending_approval",
      customerEmail: "ada@example.com",
      totalCents: 6900,
      currency: "USD",
      placedAt: "2026-03-04T05:06:07Z",
      demoSessionId: "session-a",
      timeline: [{ event: "order.placed", producer: "web", language: "TypeScript", at: "2026-03-04T05:06:07Z" }],
    },
    newer: {
      orderId: "newer",
      status: "processing_payment",
      customerEmail: "ada@example.com",
      totalCents: 4500,
      currency: "USD",
      placedAt: "2026-03-04T05:10:00Z",
      demoSessionId: "session-a",
      timeline: [],
    },
    theirs: {
      orderId: "theirs",
      status: "paid",
      customerEmail: "grace@example.com",
      totalCents: 1200,
      currency: "USD",
      placedAt: "2026-03-04T05:00:00Z",
      demoSessionId: "session-b",
      timeline: [],
    },
  },
};

describe("the order read model", () => {
  test("shows only the orders of the current demo session", () => {
    // A new demo session hides earlier orders. It never deletes them, so the
    // filtering has to happen here rather than in the engine.
    const orders = ordersForSession(projection, "session-a");

    expect(orders.map((order) => order.orderId).sort()).toEqual(["mine", "newer"]);
  });

  test("puts the newest order first", () => {
    // The shop shows the order you just placed at the top, not at the bottom of
    // a list that grows all demo.
    const orders = ordersForSession(projection, "session-a");

    expect(orders.map((order) => order.orderId)).toEqual(["newer", "mine"]);
  });

  test("the approval queue holds only orders still waiting for a decision", () => {
    // Every order must be approved, so the queue is the operator's whole job.
    // An order already in payment, or paid, is not theirs to act on.
    const queue = pendingApprovals(ordersForSession(projection, "session-a"));

    expect(queue.map((order) => order.orderId)).toEqual(["mine"]);
  });
});

// ── The payment side of the read model ──────────────────────────

const paying = (overrides: Partial<ProjectedOrder> = {}): ProjectedOrder => ({
  orderId: "aaaa",
  status: "processing_payment",
  customerEmail: "ada@example.com",
  totalCents: 6900,
  currency: "USD",
  placedAt: "2026-03-04T05:06:07Z",
  demoSessionId: "session-a",
  paymentMethodToken: "pm_success",
  timeline: [],
  ...overrides,
});

describe("paymentStage", () => {
  test("is not started until the payment worker records something", () => {
    expect(paymentStage(paying())).toBe("not_started");
  });

  // The invariant the whole example turns on: an authorization is a hold, so
  // the operator sees "authorized", never "paid", until a capture lands.
  test("is authorized while only the hold exists", () => {
    expect(paymentStage(paying({ authorizationId: "auth_1" }))).toBe("authorized");
  });

  test("is captured once the capture lands", () => {
    expect(paymentStage(paying({ authorizationId: "auth_1", captureId: "cap_1", status: "paid" }))).toBe("captured");
  });

  test("is declined when the attempt failed, whatever else is on the order", () => {
    expect(paymentStage(paying({ status: "payment_failed", failureReason: "card_declined" }))).toBe("declined");
  });

  // Payments writes payment.declined; Ordering reacts with order.payment_failed
  // a moment later. In between, the projection holds the reason while the status
  // is still processing_payment — and the operator must not read "Not started"
  // for a payment the gateway has already refused.
  test("is declined the moment the decline reaches the read model, before the order status catches up", () => {
    expect(paymentStage(paying({ status: "processing_payment", declineReason: "card_declined" }))).toBe("declined");
  });
});

describe("inPayment", () => {
  // A filter, not a sort: it is handed the list ordersForSession already put in
  // newest-first order, and it keeps that order.
  test("keeps every order past approval and drops the ones still waiting", () => {
    const orders = [
      paying({ orderId: "newer", status: "paid" }),
      paying({ orderId: "waiting", status: "pending_approval" }),
      paying({ orderId: "older", status: "payment_failed" }),
    ];
    expect(inPayment(orders).map((order) => order.orderId)).toEqual(["newer", "older"]);
  });
});

describe("awaitingPresenterRelease", () => {
  test("is true only for a crash-scenario order that is held but not captured", () => {
    expect(awaitingPresenterRelease(paying({ paymentMethodToken: "pm_crash", authorizationId: "auth_1" }))).toBe(true);
  });

  test("is false before the hold exists — there is nothing to continue yet", () => {
    expect(awaitingPresenterRelease(paying({ paymentMethodToken: "pm_crash" }))).toBe(false);
  });

  test("is false once the capture landed", () => {
    expect(
      awaitingPresenterRelease(
        paying({ paymentMethodToken: "pm_crash", authorizationId: "auth_1", captureId: "cap_1", status: "paid" }),
      ),
    ).toBe(false);
  });

  // pm_success never parks: the worker runs straight through to capture, so
  // offering a Continue control would emit an event nothing is waiting for.
  test("is false for the scenarios that never pause", () => {
    expect(awaitingPresenterRelease(paying({ authorizationId: "auth_1" }))).toBe(false);
    expect(awaitingPresenterRelease(paying({ paymentMethodToken: "pm_decline", status: "payment_failed" }))).toBe(false);
  });
});

describe("what the timeline calls a producer", () => {
  test("names the language for each service", () => {
    expect(
      producerLabel({ event: "order.paid", producer: "orders-go", language: "Go", at: "t" }),
    ).toBe("Go");
    expect(
      producerLabel({
        event: "notification.sent",
        producer: "notifications-python",
        language: "Python",
        at: "t",
      }),
    ).toBe("Python");
  });

  test("names the browser as the browser", () => {
    // The projection records "TypeScript", which is true and useless: it is the
    // same answer as Payments, and the distinction worth drawing is that this
    // one is the page you are looking at.
    expect(producerLabel({ event: "place.order", producer: "web", language: "TypeScript", at: "t" })).toBe(
      "Browser",
    );
  });
});
