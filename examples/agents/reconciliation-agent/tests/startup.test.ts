import { afterEach, expect, it, vi } from "vitest";

const { start, createWorker } = vi.hoisted(() => {
  const start = vi.fn(async () => {});
  return { start, createWorker: vi.fn(() => ({ start })) };
});
vi.mock("@ironflow/node", async (importOriginal) => ({
  ...await importOriginal<typeof import("@ironflow/node")>(), createWorker,
}));
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); vi.clearAllMocks(); });

it.each([
  [undefined, undefined, "http://localhost:9123"],
  [undefined, "http://localhost:9998", "http://localhost:9998"],
  ["http://localhost:9997", "http://localhost:9998", "http://localhost:9997"],
])("configures worker and agent memory from %s / %s", async (primary, fallback, expected) => {
  vi.stubEnv("IRONFLOW_URL", primary);
  vi.stubEnv("IRONFLOW_SERVER_URL", fallback);
  await import("../src/worker.js");
  expect(process.env.IRONFLOW_URL).toBe(expected);
  expect(createWorker).toHaveBeenCalledWith(expect.objectContaining({ serverUrl: expected }));
  expect(start).toHaveBeenCalledOnce();
});
