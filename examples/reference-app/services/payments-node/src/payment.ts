// The Payments domain. Pure functions of the `order.released` fact and the
// folded payment stream — no SDK types, no I/O — so every rule in CONTEXT.md is
// testable without a server.

/** Facts this context writes, and the one it reacts to. */
export const EVENT_ORDER_RELEASED = "order.released";
export const EVENT_PAYMENT_AUTHORIZED = "payment.authorized";
export const EVENT_PAYMENT_CAPTURED = "payment.captured";
export const EVENT_PAYMENT_DECLINED = "payment.declined";

/** Demo scaffolding: the presenter's release for the crash scenario. */
export const EVENT_DEMO_CONTINUE = "demo.payment.continue";

/** The value this service writes into every fact's metadata. */
export const PRODUCER = "payments-node";

/** The entity type of every `payment-{orderId}` stream. */
export const ENTITY_TYPE = "payment";

/** The `order.released` payload, as this context needs it. */
export type Released = {
  orderId: string;
  totalCents: number;
  currency: string;
  paymentMethodToken: string;
  releasedAt: string;
};

/** One event on a payment stream, reduced to what folding needs. */
export type Fact = {
  name: string;
  data: Record<string, unknown>;
  entityVersion: number;
};

/**
 * The folded payment attempt.
 *
 * `settled` is the "one attempt per order" invariant: a captured or declined
 * payment is finished, and nothing in this context reopens it.
 */
export type PaymentState = {
  /** Entity version of the last fact — the expected version of the next append. */
  version: number;
  attempted: boolean;
  authorized: boolean;
  settled: boolean;
  /** The recorded outcome, so a replay reads it off the stream, not the gateway. */
  authorizationId: string;
  captureId: string;
  declineReason: string;
};

/** One write to a payment stream, decided by the domain. */
export type Append = {
  name: string;
  data: Record<string, unknown>;
  /** The version the stream must be at. 0 means "this stream does not exist yet". */
  expectedVersion: number;
  /** Derived from the order and the fact, never from process-local randomness. */
  idempotencyKey: string;
};

/** The entity ID of an order's payment stream. Ordering owns `order-{orderId}`. */
export function streamId(orderId: string): string {
  return `payment-${orderId}`;
}

/** Whether a token pauses the scenario between authorization and capture. */
export function needsPresenterRelease(paymentMethodToken: string): boolean {
  return paymentMethodToken === "pm_crash";
}

/**
 * Reads the `order.released` payload.
 *
 * Ordering is authoritative for the amount; this refuses a payload it cannot
 * charge rather than inventing a default and calling the gateway on a guess.
 */
export function parseReleased(payload: unknown): Released {
  const data = (payload ?? {}) as Record<string, unknown>;
  const orderId = typeof data.orderId === "string" ? data.orderId : "";
  const totalCents = typeof data.totalCents === "number" ? data.totalCents : 0;
  const currency = typeof data.currency === "string" ? data.currency : "";
  const paymentMethodToken = typeof data.paymentMethodToken === "string" ? data.paymentMethodToken : "";
  const releasedAt = typeof data.releasedAt === "string" ? data.releasedAt : "";

  if (!orderId) throw new Error(`${EVENT_ORDER_RELEASED} carries no orderId`);
  if (totalCents < 1) throw new Error(`${EVENT_ORDER_RELEASED} for ${orderId} carries no amount to charge`);
  if (currency !== "USD") throw new Error(`${EVENT_ORDER_RELEASED} for ${orderId} is priced in ${currency || "nothing"}, not USD`);
  if (!paymentMethodToken) throw new Error(`${EVENT_ORDER_RELEASED} for ${orderId} carries no payment method token`);

  return { orderId, totalCents, currency, paymentMethodToken, releasedAt };
}

/** Replays a payment stream into current state. */
export function fold(facts: Fact[]): PaymentState {
  const state: PaymentState = {
    version: 0,
    attempted: false,
    authorized: false,
    settled: false,
    authorizationId: "",
    captureId: "",
    declineReason: "",
  };
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  for (const fact of facts) {
    state.version = fact.entityVersion;
    switch (fact.name) {
      case EVENT_PAYMENT_AUTHORIZED:
        state.attempted = true;
        state.authorized = true;
        state.authorizationId = text(fact.data.authorizationId);
        break;
      case EVENT_PAYMENT_CAPTURED:
        state.attempted = true;
        state.settled = true;
        state.captureId = text(fact.data.captureId);
        break;
      case EVENT_PAYMENT_DECLINED:
        state.attempted = true;
        state.settled = true;
        state.declineReason = text(fact.data.reason);
        break;
    }
  }
  return state;
}

/**
 * The append that records a successful authorization, or `undefined` when the
 * fact is already on the stream.
 *
 * `undefined` is what makes a replayed step a no-op: a run that crashed after
 * appending finds its own fact here and moves on instead of failing.
 */
export function decideAuthorized(
  state: PaymentState,
  released: Released,
  authorizationId: string,
  at: string,
): Append | undefined {
  if (state.attempted) return undefined;
  return {
    name: EVENT_PAYMENT_AUTHORIZED,
    expectedVersion: state.version,
    idempotencyKey: `${EVENT_PAYMENT_AUTHORIZED}:${released.orderId}`,
    data: {
      orderId: released.orderId,
      authorizationId,
      amountCents: released.totalCents,
      currency: released.currency,
      authorizedAt: at,
    },
  };
}

/** The append that ends a permanently declined attempt. No retry follows it. */
export function decideDeclined(
  state: PaymentState,
  released: Released,
  reason: string,
  at: string,
): Append | undefined {
  if (state.attempted) return undefined;
  return {
    name: EVENT_PAYMENT_DECLINED,
    expectedVersion: state.version,
    idempotencyKey: `${EVENT_PAYMENT_DECLINED}:${released.orderId}`,
    data: { orderId: released.orderId, reason, declinedAt: at },
  };
}

/**
 * Whether an attempt may still call the gateway to authorize.
 *
 * Separated from `decideAuthorized` so the caller can ask before it charges
 * anything. A step that calls the external system first and only then discovers
 * the domain refuses it has already moved money it cannot record.
 */
export function mayAuthorize(state: PaymentState): boolean {
  return !state.attempted;
}

/**
 * Whether an attempt may still call the gateway to capture, and refuses outright
 * if it never held the card.
 *
 * Returns false for an attempt already settled — that is a replay, and the
 * memoized outcome stands. Throws when the authorization is missing, because
 * capturing what was never authorized is a bug in the caller, not a no-op.
 */
export function mayCapture(state: PaymentState, orderId: string): boolean {
  if (!state.authorized) {
    throw new Error(`cannot capture payment for ${orderId}: it was never authorized`);
  }
  return !state.settled;
}

/**
 * The append that records a capture.
 *
 * This is where "an authorization is a hold" lives: capture is refused unless
 * the authorization is on the stream, so nothing this context publishes can let
 * Ordering treat a held payment as paid.
 */
export function decideCaptured(
  state: PaymentState,
  released: Released,
  authorizationId: string,
  captureId: string,
  at: string,
): Append | undefined {
  // Order matters. A declined attempt is settled but never authorized, and that
  // is a bug in the caller rather than "already captured": it must fail the run,
  // not report success.
  if (!state.authorized) {
    throw new Error(`cannot capture payment for ${released.orderId}: it was never authorized`);
  }
  if (state.settled) return undefined;
  return {
    name: EVENT_PAYMENT_CAPTURED,
    expectedVersion: state.version,
    idempotencyKey: `${EVENT_PAYMENT_CAPTURED}:${released.orderId}`,
    data: {
      orderId: released.orderId,
      authorizationId,
      captureId,
      amountCents: released.totalCents,
      currency: released.currency,
      capturedAt: at,
    },
  };
}
