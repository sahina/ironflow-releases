// The Payments domain, with no SDK in sight. Every rule in CONTEXT.md is a pure
// function of the released order and the folded payment stream, so all of them
// are asserted here rather than against a running engine.
import { describe, expect, it } from "vitest";

import {
  decideAuthorized,
  decideCaptured,
  decideDeclined,
  fold,
  needsPresenterRelease,
  parseReleased,
  streamId,
  type Fact,
} from "./payment.js";

const ORDER = "0f3b6c1d9a4e47b28c5d1e6f70a2b3c4";
const AT = "2026-08-28T10:01:03.000Z";

const released = {
  orderId: ORDER,
  totalCents: 6900,
  currency: "USD",
  paymentMethodToken: "pm_success",
  releasedAt: "2026-08-28T10:01:01Z",
};

const fact = (name: string, entityVersion: number, data: Record<string, unknown> = {}): Fact => ({
  name,
  entityVersion,
  data: { orderId: ORDER, ...data },
});

describe("streamId", () => {
  it("names the payment stream this context owns, never the order stream", () => {
    expect(streamId(ORDER)).toBe(`payment-${ORDER}`);
  });
});

describe("parseReleased", () => {
  it("accepts the order.released payload Ordering publishes", () => {
    expect(parseReleased(released)).toEqual(released);
  });

  it.each([
    ["no orderId", { ...released, orderId: "" }],
    ["no amount", { ...released, totalCents: 0 }],
    ["a currency this example does not price in", { ...released, currency: "EUR" }],
    ["no payment method token", { ...released, paymentMethodToken: "" }],
  ])("refuses %s rather than charging a card on a guess", (_what, payload) => {
    expect(() => parseReleased(payload)).toThrow();
  });
});

describe("fold", () => {
  it("reports an untouched order as version 0, which is how a stream is opened once", () => {
    expect(fold([])).toEqual({
      version: 0, attempted: false, authorized: false, settled: false,
      authorizationId: "", captureId: "", declineReason: "",
    });
  });

  it("treats an authorization as an attempt that is not settled", () => {
    expect(fold([fact("payment.authorized", 1, { authorizationId: "auth_x" })])).toEqual({
      version: 1,
      attempted: true,
      authorized: true,
      settled: false,
      // Carried on the state so a replayed step reads the recorded outcome off
      // the stream instead of re-presenting the key to the gateway.
      authorizationId: "auth_x",
      captureId: "",
      declineReason: "",
    });
  });

  it("treats a capture as settled", () => {
    const state = fold([
      fact("payment.authorized", 1, { authorizationId: "auth_x" }),
      fact("payment.captured", 2, { captureId: "cap_x" }),
    ]);
    expect(state).toEqual({
      version: 2, attempted: true, authorized: true, settled: true,
      authorizationId: "auth_x", captureId: "cap_x", declineReason: "",
    });
  });

  it("treats a decline as settled — one attempt per order, and a decline is final", () => {
    expect(fold([fact("payment.declined", 1, { reason: "card_declined" })])).toEqual({
      version: 1,
      attempted: true,
      authorized: false,
      settled: true,
      authorizationId: "",
      captureId: "",
      declineReason: "card_declined",
    });
  });
});

describe("decideAuthorized", () => {
  it("appends at expected version 0 with a key derived from the order", () => {
    expect(decideAuthorized(fold([]), released, "auth_x", AT)).toEqual({
      name: "payment.authorized",
      expectedVersion: 0,
      idempotencyKey: `payment.authorized:${ORDER}`,
      data: {
        orderId: ORDER,
        authorizationId: "auth_x",
        amountCents: 6900,
        currency: "USD",
        authorizedAt: AT,
      },
    });
  });

  it("writes nothing when the fact is already on the stream", () => {
    const state = fold([fact("payment.authorized", 1)]);
    expect(decideAuthorized(state, released, "auth_x", AT)).toBeUndefined();
  });
});

describe("decideDeclined", () => {
  it("appends at expected version 0 and ends the attempt", () => {
    expect(decideDeclined(fold([]), released, "card_declined", AT)).toEqual({
      name: "payment.declined",
      expectedVersion: 0,
      idempotencyKey: `payment.declined:${ORDER}`,
      data: { orderId: ORDER, reason: "card_declined", declinedAt: AT },
    });
  });

  it("writes nothing once the attempt has settled", () => {
    expect(decideDeclined(fold([fact("payment.declined", 1)]), released, "card_declined", AT)).toBeUndefined();
  });
});

describe("decideCaptured", () => {
  it("appends after the authorization, at the version the authorization left", () => {
    const state = fold([fact("payment.authorized", 1)]);
    expect(decideCaptured(state, released, "auth_x", "cap_x", AT)).toEqual({
      name: "payment.captured",
      expectedVersion: 1,
      idempotencyKey: `payment.captured:${ORDER}`,
      data: {
        orderId: ORDER,
        authorizationId: "auth_x",
        captureId: "cap_x",
        amountCents: 6900,
        currency: "USD",
        capturedAt: AT,
      },
    });
  });

  // The invariant the whole example turns on: an authorization is a hold, and
  // only a capture can make an order paid.
  it("refuses to capture what was never authorized", () => {
    expect(() => decideCaptured(fold([]), released, "auth_x", "cap_x", AT)).toThrow(/authoriz/i);
  });

  it("writes nothing when the capture is already on the stream", () => {
    const state = fold([fact("payment.authorized", 1), fact("payment.captured", 2)]);
    expect(decideCaptured(state, released, "auth_x", "cap_x", AT)).toBeUndefined();
  });

  it("refuses to capture a declined attempt", () => {
    expect(() => decideCaptured(fold([fact("payment.declined", 1)]), released, "auth_x", "cap_x", AT)).toThrow();
  });
});

describe("needsPresenterRelease", () => {
  it("pauses only the crash scenario between authorization and capture", () => {
    expect(needsPresenterRelease("pm_crash")).toBe(true);
    expect(needsPresenterRelease("pm_success")).toBe(false);
    expect(needsPresenterRelease("pm_decline")).toBe(false);
  });
});
