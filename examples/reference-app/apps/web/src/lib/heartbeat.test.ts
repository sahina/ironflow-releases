import { describe, expect, test } from "vitest";

import { FRESH_HEARTBEAT_MS, heartbeatIsFresh, parseHeartbeat } from "@/lib/heartbeat";

describe("the Python subscriber's heartbeat", () => {
  test("reads the base64 value the REST entry carries", () => {
    // Go marshals []byte as base64, so this is what /api/v1/kv returns.
    const value = btoa(JSON.stringify({ service: "notifications-python", at: "2026-08-28T10:00:00Z" }));

    expect(parseHeartbeat({ value })).toEqual({
      service: "notifications-python",
      at: "2026-08-28T10:00:00Z",
    });
  });

  test("takes an already-decoded value as it is", () => {
    // The browser SDK's KV client hands back the parsed object.
    const beat = { service: "notifications-python", at: "2026-08-28T10:00:00Z" };

    expect(parseHeartbeat({ value: beat })).toEqual(beat);
  });

  test("treats anything unreadable as no heartbeat", () => {
    expect(parseHeartbeat(undefined)).toBeUndefined();
    expect(parseHeartbeat({})).toBeUndefined();
    expect(parseHeartbeat({ value: "not base64 json" })).toBeUndefined();
  });

  test("is fresh for the same window a worker heartbeat is", () => {
    // One window for both services: a presenter watching /system should see
    // them appear and disappear at the same speed.
    const now = new Date("2026-08-28T10:00:00Z").getTime();

    expect(heartbeatIsFresh({ at: "2026-08-28T09:59:55Z" }, now)).toBe(true);
    expect(heartbeatIsFresh({ at: new Date(now - FRESH_HEARTBEAT_MS - 1).toISOString() }, now)).toBe(false);
  });

  test("does not call a clock-skewed future beat stale", () => {
    const now = new Date("2026-08-28T10:00:00Z").getTime();

    expect(heartbeatIsFresh({ at: "2026-08-28T10:00:02Z" }, now)).toBe(true);
  });

  test("is not fresh with no timestamp at all", () => {
    expect(heartbeatIsFresh(undefined, Date.now())).toBe(false);
    expect(heartbeatIsFresh({ at: "never" }, Date.now())).toBe(false);
  });
});
