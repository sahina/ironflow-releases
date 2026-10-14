import assert from "node:assert/strict";
import { createServer } from "node:http";
import { KVClient } from "@ironflow/node";
import { incrementVelocity } from "./velocity.ts";

// Mimics the engine's KV handler: entries keyed by bucket + key, and a
// "bucket not found" 404 that is distinct from "key not found".
const buckets = new Set(["test", "fraud-velocity"]);
const entries = new Map();
let revision = 0;
let createAttempts = 0;
let forceConflict = false;
const server = createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  const [, bucket] = req.url.match(/^\/api\/v1\/kv\/buckets\/([^/]+)\/keys\//) ?? [];
  const id = req.url;
  const previous = entries.get(id);
  if (!buckets.has(bucket)) {
    res.writeHead(404).end(JSON.stringify({ error: "bucket not found" }));
  } else if (req.method === "PUT") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (req.headers["if-none-match"]) createAttempts++;
    if (forceConflict || (req.headers["if-none-match"] && previous)
        || (req.headers["if-match"] && Number(req.headers["if-match"]) !== previous?.revision)) {
      res.writeHead(412).end(JSON.stringify({ error: "revision mismatch" }));
      return;
    }
    entries.set(id, { bytes: Buffer.concat(chunks), revision: ++revision });
    res.end(JSON.stringify({ revision }));
  } else if (!previous) {
    res.writeHead(404).end(JSON.stringify({ error: "key not found" }));
  } else {
    res.end(JSON.stringify({ key: id.split("/").at(-1), value: previous.bytes.toString("base64"), revision: previous.revision, created_at: "", operation: "put" }));
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
try {
  const kv = new KVClient({ serverUrl: `http://127.0.0.1:${server.address().port}`, timeout: 5000 });
  const bucket = kv.bucket("test");
  await assert.rejects(bucket.getJSON("counter"), { code: "HTTP_404", status: 404 });
  await bucket.put("counter", 1);
  assert.equal((await bucket.get("counter")).value, "MQ==");
  const entry = await bucket.getJSON("counter");
  assert.equal(entry.value, 1);
  await bucket.update("counter", entry.value + 1, entry.revision);
  assert.equal((await bucket.getJSON("counter")).value, 2);
  await bucket.put("counter", { city: "東京", emoji: "🌍" });
  assert.deepEqual((await bucket.getJSON("counter")).value, { city: "東京", emoji: "🌍" });
  await bucket.put("counter", "raw text");
  await assert.rejects(bucket.getJSON("counter"), { code: "INVALID_KV_JSON", retryable: false });
  console.log("PASS: built Node SDK over real HTTP, raw get, JSON counter 1 -> 2, Unicode, 404, invalid JSON");

  const velocity = kv.bucket("fraud-velocity");
  assert.equal(await incrementVelocity(velocity, "card"), 1);
  assert.equal(await incrementVelocity(velocity, "card"), 2);
  assert.equal((await velocity.getJSON("card.1h")).value, 2);
  await assert.rejects(bucket.getJSON("card.1h"), { status: 404 }, "buckets do not share keys");

  // A 412 from update() or create() must be retryable so step.run re-reads the revision.
  const attempts = createAttempts;
  forceConflict = true;
  await assert.rejects(incrementVelocity(velocity, "card"), { status: 412, retryable: true });
  forceConflict = false;
  assert.equal(createAttempts, attempts, "CAS failures do not create a key");
  entries.delete("/api/v1/kv/buckets/fraud-velocity/keys/card.1h");
  forceConflict = true;
  await assert.rejects(incrementVelocity(velocity, "card"), { status: 412, retryable: true });
  forceConflict = false;
  assert.equal(await incrementVelocity(velocity, "card"), 1);

  const attemptsAfterRaces = createAttempts;
  await velocity.put("card.1h", {});
  await assert.rejects(incrementVelocity(velocity, "card"), { name: "NonRetryableError", message: "Velocity counter must be a number" });
  await velocity.put("card.1h", "bad JSON");
  await assert.rejects(incrementVelocity(velocity, "card"), { code: "INVALID_KV_JSON" });
  assert.equal(createAttempts, attemptsAfterRaces, "invalid counters do not create a key");

  buckets.delete("fraud-velocity");
  await assert.rejects(incrementVelocity(velocity, "card"), { status: 404, retryable: false, message: "bucket not found" });
  console.log("PASS: velocity counter increments 1 -> 2; update/create conflicts are retryable; invalid counters and a missing bucket fail");
} finally {
  await new Promise(resolve => server.close(resolve));
}
