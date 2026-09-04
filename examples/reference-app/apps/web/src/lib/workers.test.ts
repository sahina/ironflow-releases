// Worker presence, as the operations view reads it.
//
// The engine never removes a worker record: internal/server/worker_rest.go has
// no reaper, so a SIGKILLed worker stays in GET /api/v1/workers forever and a
// restarted one appears beside it under a new id. Presence therefore has to
// mean "some worker running this function has a fresh heartbeat", which is what
// these cases pin.
import { describe, expect, it } from "vitest";

import { FRESH_HEARTBEAT_MS, parseWorkers, paymentWorkerPresent } from "@/lib/workers";

const at = (isoMinusMs: number) => new Date(Date.parse("2026-08-28T10:00:00Z") - isoMinusMs).toISOString();
const NOW = new Date("2026-08-28T10:00:00Z");

const worker = (overrides: Record<string, unknown> = {}) => ({
  id: "worker-1",
  function_ids: ["process-payment"],
  last_heartbeat: at(0),
  ...overrides,
});

describe("parseWorkers", () => {
  it("reads the snake_case shape the REST endpoint returns", () => {
    expect(parseWorkers([worker()])).toEqual([
      { id: "worker-1", functionIds: ["process-payment"], lastHeartbeat: at(0) },
    ]);
  });

  it("drops a record it cannot read rather than reporting a worker that is not there", () => {
    expect(parseWorkers([null, "nonsense", { id: 7 }])).toEqual([]);
  });
});

describe("paymentWorkerPresent", () => {
  it("is present while a heartbeat is fresh", () => {
    expect(paymentWorkerPresent(parseWorkers([worker()]), NOW)).toBe(true);
  });

  it("is absent once every heartbeat has gone stale", () => {
    const stale = worker({ last_heartbeat: at(FRESH_HEARTBEAT_MS + 1_000) });
    expect(paymentWorkerPresent(parseWorkers([stale]), NOW)).toBe(false);
  });

  // The shape a crash actually leaves behind: the killed worker's record stays,
  // and the replacement registers under a new id.
  it("is present when a restarted worker sits beside the killed one", () => {
    const killed = worker({ id: "worker-1", last_heartbeat: at(FRESH_HEARTBEAT_MS + 60_000) });
    const restarted = worker({ id: "worker-2", last_heartbeat: at(200) });
    expect(paymentWorkerPresent(parseWorkers([killed, restarted]), NOW)).toBe(true);
  });

  it("ignores a fresh worker that does not run the payment function", () => {
    const ordering = worker({ id: "worker-3", function_ids: ["place-order", "approve-order"] });
    expect(paymentWorkerPresent(parseWorkers([ordering]), NOW)).toBe(false);
  });

  // Number.isFinite guards this. Without it Date.parse returns NaN, every
  // comparison is false, and the worker reads as absent by accident rather than
  // by rule — the right answer for the wrong reason, until someone inverts the
  // comparison.
  it("treats a heartbeat it cannot parse as absent", () => {
    expect(paymentWorkerPresent(parseWorkers([worker({ last_heartbeat: "not a date" })]), NOW)).toBe(false);
  });

  it("counts a heartbeat exactly at the window edge as fresh", () => {
    const edge = worker({ last_heartbeat: at(FRESH_HEARTBEAT_MS) });
    expect(paymentWorkerPresent(parseWorkers([edge]), NOW)).toBe(true);
  });

  it("is absent when the engine lists nothing", () => {
    expect(paymentWorkerPresent([], NOW)).toBe(false);
  });
});
