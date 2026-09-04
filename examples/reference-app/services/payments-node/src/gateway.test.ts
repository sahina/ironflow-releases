// The gateway seam. These assertions are what "one external side effect" means
// for the crash proof in scripts/test-crash-resume.mjs: the process-level test
// reads the same table this suite reads.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openGateway, type Gateway } from "./gateway.js";

const ORDER = "0f3b6c1d9a4e47b28c5d1e6f70a2b3c4";

let dir: string;
let gateway: Gateway;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "refapp-gateway-"));
  gateway = openGateway(join(dir, "gateway.db"));
});

afterEach(() => {
  gateway.close();
  rmSync(dir, { recursive: true, force: true });
});

const authorize = (token: string, key = `auth:${ORDER}`) =>
  gateway.authorize({
    idempotencyKey: key,
    orderId: ORDER,
    amountCents: 6900,
    currency: "USD",
    paymentMethodToken: token,
  });

describe("authorize", () => {
  // The three outcomes are committed literals, not re-derived from the same
  // table the implementation reads.
  it("approves pm_success", () => {
    expect(authorize("pm_success")).toEqual({ status: "authorized", authorizationId: `auth_${ORDER}` });
  });

  it("approves pm_crash — the crash scenario differs after authorization, not during", () => {
    expect(authorize("pm_crash")).toEqual({ status: "authorized", authorizationId: `auth_${ORDER}` });
  });

  it("permanently declines pm_decline", () => {
    expect(authorize("pm_decline")).toEqual({ status: "declined", reason: "card_declined" });
  });

  it("refuses a token the demo does not define rather than guessing an outcome", () => {
    expect(() => authorize("pm_unknown")).toThrow(/pm_unknown/);
  });
});

describe("idempotency", () => {
  it("returns the stored result and counts one side effect for a repeated key", () => {
    const first = authorize("pm_success");
    const second = authorize("pm_success");

    expect(second).toEqual(first);
    expect(gateway.callCount(ORDER, "authorize")).toBe(1);
    // Separately countable, because the crash proof needs to tell a step that
    // was skipped by durable replay from a step that really ran again and was
    // saved by the key alone.
    expect(gateway.dedupHits(ORDER, "authorize")).toBe(1);
  });

  it("records no repeat for a key the ledger has never seen", () => {
    authorize("pm_success");
    expect(gateway.dedupHits(ORDER, "authorize")).toBe(0);
  });

  // An idempotency key is a promise that the request behind it is unchanged.
  // Replaying a stored approval for a key presented with different parameters is
  // how a real gateway gets used to move the wrong money.
  it("refuses a key presented with a different token", () => {
    authorize("pm_success");
    expect(() => authorize("pm_decline")).toThrow(/reused with different parameters/);
    expect(gateway.callCount(ORDER, "authorize")).toBe(1);
  });

  it("refuses a key presented with a different amount", () => {
    authorize("pm_success");
    expect(() =>
      gateway.authorize({
        idempotencyKey: `auth:${ORDER}`,
        orderId: ORDER,
        amountCents: 9900,
        currency: "USD",
        paymentMethodToken: "pm_success",
      }),
    ).toThrow(/reused with different parameters/);
  });

  it("keeps authorize and capture as separate side effects", () => {
    authorize("pm_success");
    const captured = gateway.capture({
      idempotencyKey: `capture:${ORDER}`,
      orderId: ORDER,
      authorizationId: `auth_${ORDER}`,
      amountCents: 6900,
      currency: "USD",
    });

    expect(captured).toEqual({ status: "captured", captureId: `cap_${ORDER}` });
    expect(gateway.callCount(ORDER, "authorize")).toBe(1);
    expect(gateway.callCount(ORDER, "capture")).toBe(1);
  });

  it("counts one capture across a repeated key", () => {
    gateway.capture({
      idempotencyKey: `capture:${ORDER}`,
      orderId: ORDER,
      authorizationId: `auth_${ORDER}`,
      amountCents: 6900,
      currency: "USD",
    });
    gateway.capture({
      idempotencyKey: `capture:${ORDER}`,
      orderId: ORDER,
      authorizationId: `auth_${ORDER}`,
      amountCents: 6900,
      currency: "USD",
    });
    expect(gateway.callCount(ORDER, "capture")).toBe(1);
  });
});

describe("durability", () => {
  it("survives a restart of the process that opened it", () => {
    const path = join(dir, "restart.db");
    const first = openGateway(path);
    const authorized = first.authorize({
      idempotencyKey: `auth:${ORDER}`,
      orderId: ORDER,
      amountCents: 6900,
      currency: "USD",
      paymentMethodToken: "pm_crash",
    });
    first.close();

    // A killed worker leaves the file behind; the replacement must read the
    // same decision rather than call the gateway again.
    const second = openGateway(path);
    try {
      expect(
        second.authorize({
          idempotencyKey: `auth:${ORDER}`,
          orderId: ORDER,
          amountCents: 6900,
          currency: "USD",
          paymentMethodToken: "pm_crash",
        }),
      ).toEqual(authorized);
      expect(second.callCount(ORDER, "authorize")).toBe(1);
    } finally {
      second.close();
    }
  });
});
