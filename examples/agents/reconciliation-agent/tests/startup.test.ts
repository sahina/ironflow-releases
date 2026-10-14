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
  [undefined, "http://localhost:9123"],
  ["http://localhost:9998", "http://localhost:9998"],
  ["  ", "http://localhost:9123"],
])("configures worker and agent memory from %s", async (configured, expected) => {
  vi.stubEnv("IRONFLOW_SERVER_URL", configured);
  await import("../src/worker.js");
  expect(process.env.IRONFLOW_SERVER_URL).toBe(expected);
  expect(createWorker).toHaveBeenCalledWith(expect.objectContaining({ serverUrl: expected }));
  expect(start).toHaveBeenCalledOnce();
}, 30_000); // The cold worker/SDK import can exceed Vitest's 5s default during CI.
