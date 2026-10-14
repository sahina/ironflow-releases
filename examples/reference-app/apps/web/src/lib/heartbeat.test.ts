import { describe, expect, test } from "vitest";

import { FRESH_HEARTBEAT_MS, heartbeatIsFresh, parseHeartbeat } from "@/lib/heartbeat";

describe("the Python subscriber's heartbeat", () => {
  test("takes the value getJSON() decoded", () => {
    const beat = { service: "notifications-python", at: "2026-08-28T10:00:00Z" };

    expect(parseHeartbeat({ value: beat })).toEqual(beat);
  });

  test("treats anything unreadable as no heartbeat", () => {
    expect(parseHeartbeat(undefined)).toBeUndefined();
    expect(parseHeartbeat({})).toBeUndefined();
    expect(parseHeartbeat({ value: "not base64 json" })).toBeUndefined();
    expect(parseHeartbeat({ value: 1 })).toBeUndefined();
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
