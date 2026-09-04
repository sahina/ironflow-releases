// The two step bodies, against a fake payment stream and a real gateway file.
//
// The wiring in paymentFunction is left to the live gate, the way orders-go
// does. What is covered here is what a replayed step actually does: the
// duplicated trigger, the crash between the gateway call and the append, and the
// conflict that a concurrent writer produces.
import { ConflictError } from "@ironflow/node";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openGateway, type Gateway } from "./gateway.js";
import { authorizeStep, captureStep, factMetadata, type Deps, type Streams } from "./main.js";
import { fold, type Append, type Fact } from "./payment.js";

const ORDER = "0f3b6c1d9a4e47b28c5d1e6f70a2b3c4";
const SESSION = "8a1c2d3e4f5061728394a5b6c7d8e9f0";
const CAUSE = "evt_order_released_1";
const NOW = new Date("2026-08-28T10:01:03.000Z");

const released = (paymentMethodToken: string) => ({
  orderId: ORDER,
  totalCents: 6900,
  currency: "USD",
  paymentMethodToken,
  releasedAt: "2026-08-28T10:01:01Z",
});

/**
 * A payment stream that enforces the same optimistic rule the engine does: an
 * append whose expected version is not the stream's current version is refused
 * with the error class the SDK raises for HTTP 409.
 */
function fakeStreams() {
  const facts: Fact[] = [];
  const writes: { append: Append; metadata: Record<string, unknown> }[] = [];
  const streams: Streams = {
    async read() {
      return facts.map((fact) => ({ ...fact }));
    },
    async append(_orderId, append, metadata) {
      const version = facts.at(-1)?.entityVersion ?? 0;
      if (append.expectedVersion !== version) {
        throw new ConflictError(`expected version ${append.expectedVersion}, stream is at ${version}`);
      }
      facts.push({ name: append.name, data: append.data, entityVersion: version + 1 });
      writes.push({ append, metadata });
      return version + 1;
    },
  };
  return { streams, facts, writes };
}

let dir: string;
let gateway: Gateway;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "refapp-payments-"));
  gateway = openGateway(join(dir, "gateway.db"));
});

afterEach(() => {
  gateway.close();
  rmSync(dir, { recursive: true, force: true });
});

const depsFor = (streams: Streams): Deps => ({ streams, gateway, now: () => NOW });

describe("factMetadata", () => {
  it("carries correlation, causation and producer, and drops an absent session", () => {
    expect(factMetadata(ORDER, CAUSE, SESSION)).toEqual({
      correlationId: ORDER,
      causationId: CAUSE,
      producer: "payments-node",
      demoSessionId: SESSION,
    });
    expect(factMetadata(ORDER, CAUSE, "")).not.toHaveProperty("demoSessionId");
  });
});

describe("authorizeStep", () => {
  it("holds the card once and records the fact", async () => {
    const { streams, facts, writes } = fakeStreams();
    const outcome = await authorizeStep(depsFor(streams), released("pm_success"), CAUSE, SESSION);

    expect(outcome).toEqual({ status: "authorized", authorizationId: `auth_${ORDER}` });
    expect(facts.map((f) => f.name)).toEqual(["payment.authorized"]);
    expect(writes[0]?.append.expectedVersion).toBe(0);
    expect(writes[0]?.metadata).toEqual(factMetadata(ORDER, CAUSE, SESSION));
  });

  // The guard in appendOnce that is NOT about conflicts. Without it a network
  // failure mid-append reports success, the run checkpoints, and a payment fact
  // is lost with nothing anywhere saying so. Deleting the `instanceof` check
  // passes every other test in this file.
  it("propagates a real append failure instead of swallowing it", async () => {
    const { streams } = fakeStreams();
    const failing: Streams = {
      read: streams.read,
      append: async () => {
        throw new Error("network error");
      },
    };

    await expect(
      authorizeStep(depsFor(failing), released("pm_success"), CAUSE, SESSION),
    ).rejects.toThrow("network error");
  });

  it("declines permanently and writes no authorization", async () => {
    const { streams, facts } = fakeStreams();
    const outcome = await authorizeStep(depsFor(streams), released("pm_decline"), CAUSE, SESSION);

    expect(outcome).toEqual({ status: "declined", reason: "card_declined" });
    expect(facts.map((f) => f.name)).toEqual(["payment.declined"]);
  });

  // A duplicated order.released, or a run replayed after the worker was killed
  // between the gateway call and the checkpoint.
  it("holds the card once across a replay and leaves one fact on the stream", async () => {
    const { streams, facts } = fakeStreams();
    const deps = depsFor(streams);
    const first = await authorizeStep(deps, released("pm_crash"), CAUSE, SESSION);
    const replayed = await authorizeStep(deps, released("pm_crash"), CAUSE, SESSION);

    expect(replayed).toEqual(first);
    expect(facts.map((f) => f.name)).toEqual(["payment.authorized"]);
    expect(gateway.callCount(ORDER, "authorize")).toBe(1);
    // Not merely deduplicated — never asked. The step reads the recorded
    // outcome off the stream before it considers the gateway.
    expect(gateway.dedupHits(ORDER, "authorize")).toBe(0);
  });

  // The step read an empty stream, decided to append at version 0, and by the
  // time it wrote, its own earlier attempt had landed. The re-read proves the
  // intended fact is the fact on the stream, so this is success.
  it("treats a conflict its own fact won as already done", async () => {
    const { streams, facts } = fakeStreams();
    let reads = 0;
    const stale: Streams = {
      // First read is the stale view that produced the version-0 decision. The
      // second is appendOnce verifying what actually won.
      read: async () => (reads++ === 0 ? [] : streams.read(ORDER)),
      append: streams.append,
    };
    facts.push({
      name: "payment.authorized",
      data: { orderId: ORDER, authorizationId: `auth_${ORDER}` },
      entityVersion: 1,
    });

    await expect(
      authorizeStep(depsFor(stale), released("pm_success"), CAUSE, SESSION),
    ).resolves.toEqual({ status: "authorized", authorizationId: `auth_${ORDER}` });
    expect(facts).toHaveLength(1);
  });

  // The other reading of the same race: the attempt settled some other way
  // while this step was at the gateway. Returning this step's own outcome would
  // send a run whose stream says `payment.declined` on to capture a card it
  // never held, so the stream wins.
  it("returns what the stream recorded, not its own outcome, when the attempt settled underneath it", async () => {
    const { streams, facts } = fakeStreams();
    let reads = 0;
    const stale: Streams = {
      read: async () => (reads++ === 0 ? [] : streams.read(ORDER)),
      append: streams.append,
    };
    facts.push({
      name: "payment.declined",
      data: { orderId: ORDER, reason: "card_declined" },
      entityVersion: 1,
    });

    await expect(
      authorizeStep(depsFor(stale), released("pm_success"), CAUSE, SESSION),
    ).resolves.toEqual({ status: "declined", reason: "card_declined" });
    expect(facts.map((f) => f.name)).toEqual(["payment.declined"]);
  });

  // appendOnce's own guard, reached when the domain still wants to write and
  // the engine refuses the version. A conflict proves the stream moved; it does
  // not prove this fact is the one that won.
  it("fails loudly when its append conflicts and its fact is not on the stream", async () => {
    const { streams, facts } = fakeStreams();
    const stale: Streams = {
      // Always stale: the decision keeps saying "append at version 0" and the
      // verification re-read never finds payment.authorized.
      read: async () => [],
      append: streams.append,
    };
    facts.push({ name: "payment.declined", data: { orderId: ORDER, reason: "x" }, entityVersion: 1 });

    await expect(
      authorizeStep(depsFor(stale), released("pm_success"), CAUSE, SESSION),
    ).rejects.toThrow(/lost a version conflict/);
  });

  // Read and decide come before the gateway, so a duplicated trigger never
  // presents the key at all — the replay reads the recorded outcome instead.
  it("does not touch the gateway when the attempt is already on the stream", async () => {
    const { streams, facts } = fakeStreams();
    const deps = depsFor(streams);
    await authorizeStep(deps, released("pm_success"), CAUSE, SESSION);
    const replayed = await authorizeStep(deps, released("pm_success"), CAUSE, SESSION);

    expect(replayed).toEqual({ status: "authorized", authorizationId: `auth_${ORDER}` });
    expect(facts).toHaveLength(1);
    expect(gateway.dedupHits(ORDER, "authorize")).toBe(0);
  });

  it("replays a decline off the stream too", async () => {
    const { streams } = fakeStreams();
    const deps = depsFor(streams);
    await authorizeStep(deps, released("pm_decline"), CAUSE, SESSION);

    await expect(authorizeStep(deps, released("pm_decline"), CAUSE, SESSION)).resolves.toEqual({
      status: "declined",
      reason: "card_declined",
    });
    expect(gateway.dedupHits(ORDER, "authorize")).toBe(0);
  });
});

describe("captureStep", () => {
  it("captures after the authorization, at the version it left", async () => {
    const { streams, facts, writes } = fakeStreams();
    const deps = depsFor(streams);
    await authorizeStep(deps, released("pm_success"), CAUSE, SESSION);
    const outcome = await captureStep(deps, released("pm_success"), `auth_${ORDER}`, CAUSE, SESSION);

    expect(outcome).toEqual({ status: "captured", captureId: `cap_${ORDER}` });
    expect(facts.map((f) => f.name)).toEqual(["payment.authorized", "payment.captured"]);
    expect(writes[1]?.append.expectedVersion).toBe(1);
  });

  it("charges once across a replay", async () => {
    const { streams, facts } = fakeStreams();
    const deps = depsFor(streams);
    await authorizeStep(deps, released("pm_crash"), CAUSE, SESSION);
    await captureStep(deps, released("pm_crash"), `auth_${ORDER}`, CAUSE, SESSION);
    await captureStep(deps, released("pm_crash"), `auth_${ORDER}`, CAUSE, SESSION);

    expect(facts.map((f) => f.name)).toEqual(["payment.authorized", "payment.captured"]);
    expect(gateway.callCount(ORDER, "capture")).toBe(1);
    expect(gateway.callCount(ORDER, "authorize")).toBe(1);
  });

  it("refuses to capture a declined attempt", async () => {
    const { streams } = fakeStreams();
    const deps = depsFor(streams);
    await authorizeStep(deps, released("pm_decline"), CAUSE, SESSION);

    await expect(
      captureStep(deps, released("pm_decline"), `auth_${ORDER}`, CAUSE, SESSION),
    ).rejects.toThrow(/never authorized/);
  });
});

describe("the folded stream is what the operations queue reads", () => {
  it("ends a successful attempt settled and authorized", async () => {
    const { streams, facts } = fakeStreams();
    const deps = depsFor(streams);
    await authorizeStep(deps, released("pm_success"), CAUSE, SESSION);
    await captureStep(deps, released("pm_success"), `auth_${ORDER}`, CAUSE, SESSION);

    expect(fold(facts)).toEqual({
      version: 2,
      attempted: true,
      authorized: true,
      settled: true,
      authorizationId: `auth_${ORDER}`,
      captureId: `cap_${ORDER}`,
      declineReason: "",
    });
  });
});
