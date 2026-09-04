import assert from "node:assert/strict";
import test from "node:test";

import {
  HEARTBEAT_BUCKET,
  NOTIFICATIONS_HEARTBEAT_KEY,
  heartbeatIsFresh,
  parseHeartbeat,
} from "./heartbeat.mjs";

test("the bucket and key match the Python service", () => {
  assert.equal(HEARTBEAT_BUCKET, "reference-app");
  assert.equal(NOTIFICATIONS_HEARTBEAT_KEY, "notifications-heartbeat");
});

test("a KV entry carrying a base64 value is decoded", () => {
  const value = Buffer.from(JSON.stringify({ service: "notifications-python", at: "2026-08-28T10:00:00Z" })).toString("base64");
  assert.deepEqual(parseHeartbeat({ value }), {
    service: "notifications-python",
    at: "2026-08-28T10:00:00Z",
  });
});

test("a KV entry carrying a decoded object is taken as it is", () => {
  const beat = { service: "notifications-python", at: "2026-08-28T10:00:00Z" };
  assert.deepEqual(parseHeartbeat({ value: beat }), beat);
});

test("anything unreadable is no heartbeat at all", () => {
  assert.equal(parseHeartbeat(undefined), undefined);
  assert.equal(parseHeartbeat({}), undefined);
  assert.equal(parseHeartbeat({ value: "not base64 json" }), undefined);
  assert.equal(parseHeartbeat({ value: Buffer.from('"a string"').toString("base64") }), undefined);
});

test("freshness is the same window the payment worker is judged by", () => {
  const now = Date.parse("2026-08-28T10:00:10Z");
  assert.equal(heartbeatIsFresh({ at: "2026-08-28T10:00:05Z" }, now), true);
  assert.equal(heartbeatIsFresh({ at: "2026-08-28T09:59:00Z" }, now), false);
});

test("a heartbeat with no timestamp is not fresh", () => {
  assert.equal(heartbeatIsFresh(undefined, Date.now()), false);
  assert.equal(heartbeatIsFresh({ at: "never" }, Date.now()), false);
});

test("a heartbeat from the future is not treated as stale", () => {
  // Clock skew between the engine's host and this process is not a dead service.
  const now = Date.parse("2026-08-28T10:00:00Z");
  assert.equal(heartbeatIsFresh({ at: "2026-08-28T10:00:02Z" }, now), true);
});
