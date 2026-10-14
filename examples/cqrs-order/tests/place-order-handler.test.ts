import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { KVBucketHandle, KVClient, type StreamEvent } from "@ironflow/node";
import { commandDedup, type DedupEntry } from "../lib/command-dedup";
import { ironflow } from "../lib/ironflow-server";
import { customerRepo } from "../lib/enrichment";
import { placeOrderHandler } from "../lib/place-order-handler";
import type { PlaceOrderCommand } from "../lib/types";

function setup(t: TestContext) {
  const command: PlaceOrderCommand = {
    data: {
      orderId: "ord-2767",
      customerId: "cust-001",
      items: [{ productId: "prod-widget", qty: 1 }],
      shippingAddress: { street: "1 Main St", city: "Boston", zip: "02101", country: "US" },
    },
    metadata: { commandId: "cmd-2767", issuedAt: "2026-10-11T12:00:00Z", issuedBy: "test" },
  };
  const events: StreamEvent[] = [];
  const claims = new Map<string, DedupEntry>();
  t.mock.method(commandDedup, "tryClaim", async (id: string, claim: DedupEntry) => {
    const prior = claims.get(id);
    if (prior) return { ...prior };
    claims.set(id, { ...claim });
    return null;
  });
  t.mock.method(commandDedup, "finalize", async (id: string, entry: DedupEntry) => {
    claims.set(id, { ...entry });
  });
  t.mock.method(KVClient.prototype, "createBucket", async () => ({
    name: "order-commands", values: 0, bytes: 0, history: 1, created_at: "2026-10-11T12:00:00Z",
  }));
  t.mock.method(KVBucketHandle.prototype, "delete", async (id: string) => { claims.delete(id); });
  t.mock.method(ironflow.streams, "read", async () => ({ events: [...events], totalCount: events.length }));
  t.mock.method(ironflow.streams, "append", async (...[entityId, input, options]: Parameters<typeof ironflow.streams.append>) => {
    assert.equal(entityId, "ord-2767");
    const version = events.at(-1)?.entityVersion ?? 0;
    if (options?.expectedVersion !== version) throw new Error("Entity version conflict");
    const event: StreamEvent = {
      id: `event-${version + 1}`,
      name: input.name,
      data: input.data ?? {},
      entityVersion: version + 1,
      version: 1,
      timestamp: "2026-10-11T12:00:00Z",
      metadata: options.metadata,
    };
    events.push(event);
    return { entityVersion: event.entityVersion, eventId: event.id };
  });
  return { command, events, claims };
}

test("recovers a pending claim with no committed event", async (t) => {
  const { command, events, claims } = setup(t);
  claims.set("cmd-2767", { orderId: "ord-2767", claimedAt: "2026-10-11T11:00:00Z" });
  assert.deepEqual(await placeOrderHandler(command), {
    orderId: "ord-2767", entityVersion: 1, dedup: false,
  });
  assert.equal(events.length, 1);
  assert.equal(events[0]?.name, "order.placed");
  assert.equal(events[0]?.metadata?.causationId, "cmd-2767");
  assert.equal(claims.get("cmd-2767")?.entityVersion, 1);
});

function receipt(causationId = "cmd-2767"): StreamEvent {
  return {
    id: "event-1", name: "order.placed", entityVersion: 1, version: 1,
    timestamp: "2026-10-11T12:00:00Z",
    data: { orderId: "ord-2767", items: [], customer: { id: "cust-001" }, totalAmount: 12.5 },
    metadata: { causationId },
  };
}

test("repairs a pending cache from the original placement receipt", async (t) => {
  const { command, events, claims } = setup(t);
  claims.set("cmd-2767", { orderId: "ord-2767", claimedAt: "before-crash" });
  events.push(receipt(), { ...receipt(), id: "event-2", name: "order.shipped", entityVersion: 2 });
  t.mock.method(ironflow.streams, "append", async () => { throw new Error("Must not append again"); });
  t.mock.method(customerRepo, "getById", async () => { throw new Error("Customer now blocked"); });
  assert.deepEqual(await placeOrderHandler(command), { orderId: "ord-2767", entityVersion: 1, dedup: true });
  assert.equal(events.length, 2);
  assert.equal(claims.get("cmd-2767")?.entityVersion, 1);
  assert.equal(claims.get("cmd-2767")?.claimedAt, "before-crash");
});

for (const fields of [{ completedAt: "completed" }, { entityVersion: 1 }, {}]) {
  test(`recovers an incomplete or expired cache entry ${JSON.stringify(fields)}`, async (t) => {
    const { command, events, claims } = setup(t);
    if (Object.keys(fields).length) claims.set("cmd-2767", { orderId: "ord-2767", claimedAt: "old", ...fields });
    events.push(receipt());
    assert.deepEqual(await placeOrderHandler(command), { orderId: "ord-2767", entityVersion: 1, dedup: true });
    assert.equal(events.length, 1);
    assert.equal(typeof claims.get("cmd-2767")?.completedAt, "string");
  });
}

for (const metadata of [{ causationId: "another-command" }, undefined]) {
  test(`refuses to treat an unrelated event as completion ${JSON.stringify(metadata)}`, async (t) => {
    const { command, events } = setup(t);
    events.push({ ...receipt(), metadata });
    await assert.rejects(() => placeOrderHandler(command), /Order already exists/);
    assert.equal(events.length, 1);
  });
}

test("rejects a command ID already used for another order", async (t) => {
  const { command, events, claims } = setup(t);
  claims.set("cmd-2767", { orderId: "another-order", claimedAt: "old" });
  await assert.rejects(() => placeOrderHandler(command), /Command ID already used for another order/);
  assert.equal(events.length, 0);
});

test("returns a finalized entry without reading or enriching", async (t) => {
  const { command, claims } = setup(t);
  claims.set("cmd-2767", { orderId: "ord-2767", claimedAt: "old", completedAt: "done", entityVersion: 1 });
  t.mock.method(ironflow.streams, "read", async () => { throw new Error("Must not read"); });
  t.mock.method(customerRepo, "getById", async () => { throw new Error("Must not enrich"); });
  assert.deepEqual(await placeOrderHandler(command), { orderId: "ord-2767", entityVersion: 1, dedup: true });
});

test("uses a stable append key and the expected stream version", async (t) => {
  const { command } = setup(t);
  const append = ironflow.streams.append;
  t.mock.method(ironflow.streams, "append", async (...args: Parameters<typeof append>) => {
    assert.equal(args[2]?.expectedVersion, 0);
    assert.equal(args[2]?.idempotencyKey, "cqrs-order:place-order:ord-2767:cmd-2767");
    return append(...args);
  });
  assert.equal((await placeOrderHandler(command)).entityVersion, 1);
});

test("concurrent retries converge on one event", { timeout: 5000 }, async (t) => {
  const { command, events, claims } = setup(t);
  const read = ironflow.streams.read;
  let reads = 0;
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  t.mock.method(ironflow.streams, "read", async (...args: Parameters<typeof read>) => {
    const snapshot = await read(...args);
    if (++reads === 2) release();
    await gate;
    return snapshot;
  });
  const results = await Promise.all([placeOrderHandler(command), placeOrderHandler(command)]);
  assert.deepEqual(results.map((result) => result.entityVersion), [1, 1]);
  assert.equal(events.length, 1);
  assert.equal(claims.get("cmd-2767")?.entityVersion, 1);
});

test("reconciles an append that commits but loses its response", async (t) => {
  const { command, events, claims } = setup(t);
  const append = ironflow.streams.append;
  t.mock.method(ironflow.streams, "append", async (...args: Parameters<typeof append>) => {
    await append(...args);
    throw new Error("Connection lost");
  });
  assert.deepEqual(await placeOrderHandler(command), { orderId: "ord-2767", entityVersion: 1, dedup: true });
  assert.equal(events.length, 1);
  assert.equal(claims.get("cmd-2767")?.entityVersion, 1);
});

test("an append failure without a receipt remains retryable", async (t) => {
  const { command, events } = setup(t);
  const append = ironflow.streams.append;
  const failure = new Error("Append unavailable");
  const failing = t.mock.method(ironflow.streams, "append", async () => { throw failure; });
  await assert.rejects(() => placeOrderHandler(command), failure);
  assert.equal(events.length, 0);
  failing.mock.mockImplementation(append);
  assert.equal((await placeOrderHandler(command)).entityVersion, 1);
  assert.equal(events.length, 1);
});

test("a failed reconciliation read remains an error", async (t) => {
  const { command } = setup(t);
  const failure = new Error("Read unavailable");
  let reads = 0;
  t.mock.method(ironflow.streams, "read", async () => {
    if (++reads > 1) throw failure;
    return { events: [], totalCount: 0 };
  });
  t.mock.method(ironflow.streams, "append", async () => { throw new Error("Connection lost"); });
  await assert.rejects(() => placeOrderHandler(command), failure);
});

test("a finalization failure recovers on the next invocation", async (t) => {
  const { command, events, claims } = setup(t);
  const finalize = commandDedup.finalize;
  const failure = new Error("KV unavailable");
  const failing = t.mock.method(commandDedup, "finalize", async () => { throw failure; });
  await assert.rejects(() => placeOrderHandler(command), failure);
  assert.equal(events.length, 1);
  failing.mock.mockImplementation(finalize);
  assert.deepEqual(await placeOrderHandler(command), { orderId: "ord-2767", entityVersion: 1, dedup: true });
  assert.equal(events.length, 1);
  assert.equal(claims.get("cmd-2767")?.entityVersion, 1);
});

test("a late enrichment failure leaves another retry's finalized result intact", async (t) => {
  const { command, events, claims } = setup(t);
  const getCustomer = customerRepo.getById;
  const finalize = commandDedup.finalize;
  let release = () => {};
  const done = new Promise<void>((resolve) => { release = resolve; });
  let customers = 0;
  const failure = new Error("Enrichment unavailable");
  t.mock.method(customerRepo, "getById", async (id: string) => {
    if (++customers === 2) { await done; throw failure; }
    return getCustomer(id);
  });
  t.mock.method(commandDedup, "finalize", async (...args: Parameters<typeof finalize>) => {
    await finalize(...args);
    release();
  });
  const first = placeOrderHandler(command);
  const late = placeOrderHandler(command);
  await assert.rejects(() => late, failure);
  assert.equal((await first).entityVersion, 1);
  assert.equal(events.length, 1);
  assert.equal(claims.get("cmd-2767")?.entityVersion, 1);
});

// Model the engine: idempotency keys are environment-wide, and a hit returns the existing
// event without appending, whatever entity the new append targets. Other orders get their
// own in-memory streams.
function environmentWideKeys(t: TestContext) {
  const append = ironflow.streams.append;
  const read = ironflow.streams.read;
  const others = new Map<string, StreamEvent[]>();
  const keys = new Map<string, { entityVersion: number; eventId: string }>();
  t.mock.method(ironflow.streams, "read", async (...args: Parameters<typeof read>) => {
    if (args[0] === "ord-2767") return read(...args);
    const stream = others.get(args[0]) ?? [];
    return { events: [...stream], totalCount: stream.length };
  });
  t.mock.method(ironflow.streams, "append", async (...args: Parameters<typeof append>) => {
    const [entityId, input, options] = args;
    const key = options?.idempotencyKey ?? "";
    const hit = keys.get(key);
    if (hit) return hit;
    let result;
    if (entityId === "ord-2767") {
      result = await append(...args);
    } else {
      const stream = others.get(entityId) ?? [];
      const event: StreamEvent = {
        id: `${entityId}-event-${stream.length + 1}`, name: input.name, data: input.data ?? {},
        entityVersion: stream.length + 1, version: 1, timestamp: "2026-10-11T12:00:00Z", metadata: options?.metadata,
      };
      others.set(entityId, [...stream, event]);
      result = { entityVersion: event.entityVersion, eventId: event.id };
    }
    keys.set(key, result);
    return result;
  });
}

test("a command ID reused for another order after cache expiry still appends", async (t) => {
  const { command, events, claims } = setup(t);
  environmentWideKeys(t);
  await placeOrderHandler({ ...command, data: { ...command.data, orderId: "ord-other" } });
  claims.clear(); // the command cache expired
  assert.deepEqual(await placeOrderHandler(command), { orderId: "ord-2767", entityVersion: 1, dedup: false });
  assert.equal(events.length, 1);
  assert.equal(events[0]?.metadata?.causationId, "cmd-2767");
});

test("colon-bearing IDs from different commands do not share an append key", async (t) => {
  const { command, events } = setup(t);
  // Entity IDs and command IDs may contain ':'. Order "ord-2767:b" with command "c" and
  // order "ord-2767" with command "b:c" are different commands with fresh claims.
  environmentWideKeys(t);
  await placeOrderHandler({
    data: { ...command.data, orderId: "ord-2767:b" },
    metadata: { ...command.metadata, commandId: "c" },
  });
  assert.deepEqual(
    await placeOrderHandler({ ...command, metadata: { ...command.metadata, commandId: "b:c" } }),
    { orderId: "ord-2767", entityVersion: 1, dedup: false },
  );
  assert.equal(events.length, 1);
  assert.equal(events[0]?.metadata?.causationId, "b:c");
});

// Serialized pending records often carry empty defaults; none of these prove completion.
const invalidCompletions: Partial<DedupEntry>[] = [
  { completedAt: "", entityVersion: 0 },
  { completedAt: "done", entityVersion: 0 },
  { completedAt: "", entityVersion: 1 },
  { completedAt: "done", entityVersion: -1 },
  { completedAt: "done", entityVersion: 1.5 },
  { completedAt: "done", entityVersion: Number.NaN },
];
for (const fields of invalidCompletions) {
  const label = JSON.stringify(fields, (_, v) => (Number.isNaN(v) ? "NaN" : v));
  test(`an invalid completion default recovers an empty stream ${label}`, async (t) => {
    const { command, events, claims } = setup(t);
    claims.set("cmd-2767", { orderId: "ord-2767", claimedAt: "old", ...fields });
    assert.deepEqual(await placeOrderHandler(command), { orderId: "ord-2767", entityVersion: 1, dedup: false });
    assert.equal(events.length, 1);
    assert.equal(claims.get("cmd-2767")?.entityVersion, 1);
    assert.notEqual(claims.get("cmd-2767")?.completedAt, "");
  });
  test(`an invalid completion default repairs from the receipt ${label}`, async (t) => {
    const { command, events, claims } = setup(t);
    claims.set("cmd-2767", { orderId: "ord-2767", claimedAt: "old", ...fields });
    events.push(receipt());
    t.mock.method(ironflow.streams, "append", async () => { throw new Error("Must not append again"); });
    assert.deepEqual(await placeOrderHandler(command), { orderId: "ord-2767", entityVersion: 1, dedup: true });
    assert.equal(events.length, 1);
    assert.equal(claims.get("cmd-2767")?.entityVersion, 1);
    assert.notEqual(claims.get("cmd-2767")?.completedAt, "");
  });
}

// The engine's environment-wide idempotency index can acknowledge an append with a
// non-entity event (EntityVersion 0) that shares the key, appending nothing.
for (const ackVersion of [0, -1, 1.5, Number.NaN]) {
  test(`an append acknowledgement without a committed version is not success ${ackVersion}`, async (t) => {
    const { command, events, claims } = setup(t);
    t.mock.method(ironflow.streams, "append", async () => ({ entityVersion: ackVersion, eventId: "command-event" }));
    await assert.rejects(() => placeOrderHandler(command), /committed entity version/);
    assert.equal(events.length, 0);
    assert.equal(claims.get("cmd-2767")?.completedAt, undefined);
  });
}

test("an invalid append acknowledgement still recovers a committed receipt", async (t) => {
  const { command, events, claims } = setup(t);
  const append = ironflow.streams.append;
  t.mock.method(ironflow.streams, "append", async (...args: Parameters<typeof append>) => {
    await append(...args);
    return { entityVersion: 0, eventId: "ambiguous" };
  });
  assert.deepEqual(await placeOrderHandler(command), { orderId: "ord-2767", entityVersion: 1, dedup: true });
  assert.equal(events.length, 1);
  assert.equal(claims.get("cmd-2767")?.entityVersion, 1);
});

// An acknowledgement is not proof: only this command's committed receipt on the order
// stream may finalize success.
test("a positive acknowledgement without this command's receipt is not success", async (t) => {
  const { command, events, claims } = setup(t);
  // The engine's environment-wide key index can return another stream's entity event.
  t.mock.method(ironflow.streams, "append", async () => ({ entityVersion: 1, eventId: "event-on-another-stream" }));
  await assert.rejects(() => placeOrderHandler(command), /committed entity version/);
  assert.equal(events.length, 0);
  assert.equal(claims.get("cmd-2767")?.completedAt, undefined);
});

for (const [name, causationId] of [["order.placed", "another-command"], ["order.note", "cmd-2767"]]) {
  test(`a same-stream ${name} from ${causationId} is not this command's receipt`, async (t) => {
    const { command, events, claims } = setup(t);
    t.mock.method(ironflow.streams, "append", async () => {
      events.push({ ...receipt(causationId), id: "foreign-event", name });
      return { entityVersion: 1, eventId: "foreign-event" };
    });
    await assert.rejects(() => placeOrderHandler(command), /committed entity version/);
    assert.equal(events.length, 1);
    assert.equal(claims.get("cmd-2767")?.completedAt, undefined);
  });
}

test("a read failure after a positive acknowledgement leaves the claim pending", async (t) => {
  const { command, claims } = setup(t);
  const read = ironflow.streams.read;
  const failure = new Error("Read unavailable");
  let reads = 0;
  t.mock.method(ironflow.streams, "read", async (...args: Parameters<typeof read>) => {
    if (++reads > 1) throw failure;
    return read(...args);
  });
  await assert.rejects(() => placeOrderHandler(command), failure);
  assert.equal(claims.get("cmd-2767")?.completedAt, undefined);
});

test("success returns the placement version when later events follow the receipt", async (t) => {
  const { command, events, claims } = setup(t);
  const append = ironflow.streams.append;
  t.mock.method(ironflow.streams, "append", async (...args: Parameters<typeof append>) => {
    const ack = await append(...args);
    events.push({ ...receipt(), id: "event-2", name: "order.shipped", entityVersion: 2 });
    return ack;
  });
  assert.deepEqual(await placeOrderHandler(command), { orderId: "ord-2767", entityVersion: 1, dedup: false });
  assert.equal(claims.get("cmd-2767")?.entityVersion, 1);
});
