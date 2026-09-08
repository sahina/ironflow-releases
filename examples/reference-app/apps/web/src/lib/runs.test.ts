import { describe, expect, test } from "vitest";

import { parseRuns, runsForEvents, type RunSummary } from "@/lib/runs";

const EVENTS = ["evt-placed", "evt-captured"];

const runs: RunSummary[] = [
  { id: "run-1", functionId: "approve-order", eventId: "evt-placed" },
  { id: "run-2", functionId: "record-payment", eventId: "evt-captured" },
  { id: "run-3", functionId: "approve-order", eventId: "evt-other" },
];

describe("resolving timeline facts to their runs", () => {
  test("finds every run the timeline events caused, and nothing else", () => {
    expect(runsForEvents(runs, EVENTS).map((run) => run.id)).toEqual(["run-1", "run-2"]);
  });

  test("an event no recent run names has none", () => {
    // Recent runs are a window, not the whole history. An older event simply
    // shows no links, which is honest — this UI does not rebuild the inspector.
    expect(runsForEvents(runs, ["evt-old"])).toEqual([]);
  });

  test("a timeline with no event ids has no runs", () => {
    expect(runsForEvents(runs, [""])).toEqual([]);
  });

  test("reads the run list the engine actually returns", () => {
    // Accept the raw wire shape and the browser SDK's mapped shape.
    expect(
      parseRuns([
        { id: "run-1", function_id: "approve-order", event_id: "evt-placed" },
        { id: "run-2", functionId: "record-payment", eventId: "evt-captured" },
        { nonsense: true },
        "not an object",
      ]),
    ).toEqual([
      { id: "run-1", functionId: "approve-order", eventId: "evt-placed" },
      { id: "run-2", functionId: "record-payment", eventId: "evt-captured" },
    ]);
  });
});
