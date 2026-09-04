import { describe, expect, test } from "vitest";

import { serviceRows, type StatusInputs } from "@/lib/service-status";

const NOW = new Date("2026-08-28T10:00:00Z").getTime();
const fresh = { service: "notifications-python", at: "2026-08-28T09:59:58Z" };
const stale = { service: "notifications-python", at: "2026-08-28T09:50:00Z" };

const running: StatusInputs = {
  engineReachable: true,
  workers: [
    { id: "w1", functionIds: ["process-payment"], lastHeartbeat: "2026-08-28T09:59:58Z" },
    { id: "w2", functionIds: ["place-order"], lastHeartbeat: "2026-08-28T09:59:58Z" },
  ],
  notificationsHeartbeat: fresh,
  readModelConnected: true,
  now: NOW,
};

const health = (inputs: StatusInputs) =>
  Object.fromEntries(serviceRows(inputs).map((row) => [row.key, row.health]));

describe("the /system service status", () => {
  test("names all five participants once", () => {
    expect(serviceRows(running).map((row) => row.key)).toEqual([
      "engine",
      "orders",
      "payments",
      "notifications",
      "browser",
    ]);
  });

  test("reports every process up when the whole system is running", () => {
    expect(health(running)).toEqual({
      engine: "up",
      orders: "up",
      payments: "up",
      notifications: "up",
      browser: "up",
    });
  });

  test("a stale heartbeat is a subscriber that is gone, not one it cannot see", () => {
    // The Python service registers no worker, so its heartbeat is the only
    // evidence either way — an old one is a claim, not an absence.
    expect(health({ ...running, notificationsHeartbeat: stale }).notifications).toBe("down");
  });

  test("no heartbeat at all is unknown, not down", () => {
    // Before the first poll answers, and whenever the KV read fails. Saying
    // "gone" would be a claim this UI cannot support.
    expect(health({ ...running, notificationsHeartbeat: undefined }).notifications).toBe("unknown");
  });

  test("a worker with a stale heartbeat is gone even though it is still listed", () => {
    // The engine never removes a worker record, so presence is about freshness.
    expect(
      health({
        ...running,
        workers: [{ id: "w1", functionIds: ["process-payment"], lastHeartbeat: "2026-08-28T09:50:00Z" }],
      }).payments,
    ).toBe("down");
  });

  test("an unreachable engine leaves every claim about a service unknown", () => {
    // Nothing below the engine can be reported: the worker list and the KV read
    // both come from it, so their absence says nothing about the processes.
    expect(health({ ...running, engineReachable: false, workers: [], notificationsHeartbeat: undefined })).toEqual({
      engine: "down",
      orders: "unknown",
      payments: "unknown",
      notifications: "unknown",
      browser: "down",
    });
  });

  test("the browser row reports this page's own subscription", () => {
    expect(health({ ...running, readModelConnected: false }).browser).toBe("down");
  });

  test("the browser row is unknown until its subscription has delivered", () => {
    // A reachable engine says nothing about whether the projection is being
    // delivered to this page. Reporting "Running" on the strength of a health
    // check is the exact overclaim this page exists to avoid.
    expect(health({ ...running, readModelConnected: undefined }).browser).toBe("unknown");
  });

  test("each row names the language it is written in", () => {
    expect(serviceRows(running).map((row) => row.language)).toEqual([
      "Go",
      "Go",
      "TypeScript",
      "Python",
      "TypeScript",
    ]);
  });

  test("each row says what evidence its health rests on", () => {
    // The interesting half of this page: not "is it up" but "how would you
    // know". A client-only subscriber cannot be judged the way a worker is.
    const rows = Object.fromEntries(serviceRows(running).map((row) => [row.key, row.evidence]));

    expect(rows.payments).toMatch(/heartbeat/i);
    expect(rows.notifications).toMatch(/heartbeat/i);
    expect(rows.notifications).toMatch(/no worker/i);
  });
});
