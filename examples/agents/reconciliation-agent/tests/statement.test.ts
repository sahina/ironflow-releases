import { beforeEach, expect, it, vi } from "vitest";
import { IronflowError } from "@ironflow/node";
import { buildStatement } from "../scripts/build-statement.js";

const { emit } = vi.hoisted(() => ({
  emit: vi.fn(async (_name: string, _data: unknown, _options: { idempotencyKey: string }) => ({
    runIds: ["case-run"], eventId: "case-event",
  })),
}));
vi.mock("@ironflow/node", async (importOriginal) => ({
  ...await importOriginal<typeof import("@ironflow/node")>(),
  createClient: () => ({ projections: { get: async () => ({ state: {}, version: 0 }) }, emit }),
}));
import { reconcileStatement } from "../src/statement.js";
import { reconciliationCaseAgent } from "../src/agent.js";

beforeEach(() => emit.mockReset());

function context() {
  const context = {
    event: { data: buildStatement() },
    logger: { info() {} },
    step: {
      run: async (_name: string, callback: () => Promise<unknown>) => callback(),
      invokeAsync: async () => ({ runId: "old-child" }),
    },
  } as unknown as Parameters<typeof reconcileStatement.handler>[0];
  return context;
}

it("uses stable event keys across statement runs", async () => {
  await reconcileStatement.handler(context());
  await reconcileStatement.handler(context());
  expect(emit).toHaveBeenCalledTimes(10);
  expect(emit.mock.calls[0]).toEqual([
    "reconciliation.case.requested",
    expect.objectContaining({ caseId: "case-2026-09-01-vendor-a-0252abba" }),
    { idempotencyKey: "reconciliation:case-2026-09-01-vendor-a-0252abba" },
  ]);
  expect(emit.mock.calls.slice(0, 5)).toEqual(emit.mock.calls.slice(5));
  expect(reconciliationCaseAgent.config.triggers).toEqual([{ event: "reconciliation.case.requested" }]);
});

it("recovers a concurrent insert conflict by re-reading the same event key", async () => {
  emit.mockRejectedValueOnce(new IronflowError("already exists"));
  await reconcileStatement.handler(context());
  expect(emit).toHaveBeenCalledTimes(6);
  expect(emit.mock.calls[0]).toEqual(emit.mock.calls[1]);
});

it("propagates a persistent emit failure instead of silently losing the case", async () => {
  emit.mockRejectedValueOnce(new IronflowError("unavailable"));
  emit.mockRejectedValueOnce(new IronflowError("unavailable"));
  await expect(reconcileStatement.handler(context())).rejects.toThrow("unavailable");
  expect(emit).toHaveBeenCalledTimes(2);
});
