import { describe, expect, test } from "vitest";

import { parseRuns, runsForOrder, type RunSummary } from "@/lib/runs";

const ORDER = "0f3b6c1d9a4e47b28c5d1e6f70a2b3c4";

const runs: RunSummary[] = [
  { id: "run-1", functionId: "place-order", orderId: ORDER },
  { id: "run-2", functionId: "process-payment", orderId: ORDER },
  { id: "run-3", functionId: "place-order", orderId: "1a2b3c4d5e6f708192a3b4c5d6e7f809" },
  { id: "run-4", functionId: "health-probe" },
];

describe("resolving an order to its runs", () => {
  test("finds every run the order caused, and nothing else", () => {
    expect(runsForOrder(runs, ORDER).map((run) => run.id)).toEqual(["run-1", "run-2"]);
  });

  test("an order no recent run names has none", () => {
    // Recent runs are a window, not the whole history. An older order simply
    // shows no links, which is honest — this UI does not rebuild the inspector.
    expect(runsForOrder(runs, "9".repeat(32))).toEqual([]);
  });

  test("a run with no order in its input never matches an order without one", () => {
    // The trap this guards: `undefined === undefined` would match run-4 to any
    // caller that passed an empty id.
    expect(runsForOrder(runs, "")).toEqual([]);
  });

  test("reads the run list the engine actually returns", () => {
    // Snake case on the wire, and the order lives in the triggering event's
    // data, which the engine records as the run input.
    expect(
      parseRuns([
        { id: "run-1", function_id: "place-order", input: { orderId: ORDER, totalCents: 4500 } },
        { id: "run-2", function_id: "process-payment", input: null },
        { nonsense: true },
        "not an object",
      ]),
    ).toEqual([
      { id: "run-1", functionId: "place-order", orderId: ORDER },
      { id: "run-2", functionId: "process-payment", orderId: undefined },
    ]);
  });
});
