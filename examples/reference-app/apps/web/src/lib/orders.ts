// The read model, as this UI sees it.
//
// The engine owns the projection; the browser subscribes to it and never folds
// a raw stream. Everything here works on the state the Go reducer writes —
// already peeled out of its envelope by `getProjection`.

export type TimelineEntry = {
  event: string;
  producer: string;
  language: string;
  at: string;
  eventId?: string;
};

/**
 * What the timeline calls the thing that produced a fact.
 *
 * The projection records a language, which is right for the three services and
 * wrong for the browser: "TypeScript" there names the same language as
 * Payments, and the interesting distinction is that one of them is the page you
 * are looking at.
 */
export function producerLabel(entry: TimelineEntry): string {
  return entry.producer === "web" ? "Browser" : entry.language;
}

export type ProjectedOrder = {
  orderId: string;
  status: "pending_approval" | "processing_payment" | "paid" | "payment_failed";
  customerEmail: string;
  totalCents: number;
  currency: string;
  placedAt: string;
  demoSessionId?: string;
  /** The demo scenario the customer chose. Set on `order.placed`. */
  paymentMethodToken?: string;
  approvedBy?: string;
  captureId?: string;
  authorizationId?: string;
  failureReason?: string;
  declineReason?: string;
  notification?: { messageId: string; status: string; channel: string; sentAt: string };
  timeline: TimelineEntry[];
};

export type OrdersProjection = {
  orders?: Record<string, ProjectedOrder>;
};

/** The orders this browser's demo session should see, newest first. */
export function ordersForSession(state: OrdersProjection, session: string): ProjectedOrder[] {
  return Object.values(state.orders ?? {})
    .filter((order) => order.demoSessionId === session)
    .sort((a, b) => b.placedAt.localeCompare(a.placedAt));
}

/** The operator's queue: orders that still need a decision. */
export function pendingApprovals(orders: ProjectedOrder[]): ProjectedOrder[] {
  return orders.filter((order) => order.status === "pending_approval");
}

/**
 * How far the payment attempt has got.
 *
 * Not a customer-facing state — the customer sees four, and an authorization is
 * not one of them. This is what the operator watches, and keeping it derived
 * from the projection means it can never disagree with the facts on the stream.
 */
export type PaymentStage = "not_started" | "authorized" | "captured" | "declined";

export function paymentStage(order: ProjectedOrder): PaymentStage {
  // `declineReason` first, not only the order status. Payments writes
  // `payment.declined` and Ordering reacts with `order.payment_failed` a moment
  // later; between the two the projection holds the reason while the status is
  // still `processing_payment`, and reading only the status showed the operator
  // "Not started" for a payment that had already been refused.
  if (order.status === "payment_failed" || order.declineReason) return "declined";
  if (order.captureId) return "captured";
  if (order.authorizationId) return "authorized";
  return "not_started";
}

/** Every order past approval, newest first. The operator's payment view. */
export function inPayment(orders: ProjectedOrder[]): ProjectedOrder[] {
  return orders.filter((order) => order.status !== "pending_approval");
}

/**
 * Whether this order is parked on the demo's durable wait.
 *
 * Only `pm_crash` pauses between the hold and the capture, and only after the
 * hold exists. Offering Continue payment anywhere else emits a control event
 * with no run waiting for it.
 */
export function awaitingPresenterRelease(order: ProjectedOrder): boolean {
  return (
    order.paymentMethodToken === "pm_crash" && paymentStage(order) === "authorized"
  );
}

/** What a customer reads for each of the four states. */
const STATUS_LABELS: Record<ProjectedOrder["status"], string> = {
  pending_approval: "Waiting for approval",
  processing_payment: "Taking payment",
  paid: "Paid",
  payment_failed: "Payment failed",
};

export function statusLabel(status: ProjectedOrder["status"]): string {
  return STATUS_LABELS[status];
}
