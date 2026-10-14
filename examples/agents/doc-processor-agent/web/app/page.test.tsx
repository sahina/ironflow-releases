import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ironflow, type AgentSubscribeCallbacks } from "@ironflow/browser";
import Home from "./page";

vi.mock("@ironflow/browser", () => ({
  ironflow: {
    configure: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    agents: { invoke: vi.fn(), subscribe: vi.fn(), readMemory: vi.fn() },
  },
}));

let root: Root;
let container: HTMLDivElement;
let subscriptions: {
  runId: string;
  callbacks: AgentSubscribeCallbacks;
  unsubscribe: ReturnType<typeof vi.fn>;
}[];

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  subscriptions = [];
  vi.mocked(ironflow.agents.invoke).mockImplementation(async () => ({
    runId: `run-${subscriptions.length + 1}`,
    durationMs: 1,
    output: { docId: "doc-demo-1", category: "invoice" },
  }));
  vi.mocked(ironflow.agents.subscribe).mockImplementation(async (runId, callbacks) => {
    const unsubscribe = vi.fn();
    subscriptions.push({ runId, callbacks, unsubscribe });
    return { id: runId, pattern: `system.run.${runId}.>`, connectionState: "connected", unsubscribe };
  });
  vi.mocked(ironflow.agents.readMemory).mockResolvedValue({
    state: { "doc-demo-1": { docId: "doc-demo-1", status: "published" } },
    version: 1,
    caughtUp: true,
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Home />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function run() {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === "Run agent"
  );
  expect(button, "Run agent button missing").toBeDefined();
  await act(async () => button!.click());
}

function step(index: number, stepId: string) {
  const sub = subscriptions[index];
  sub.callbacks.onStep?.({
    stepId,
    type: "created",
    topic: `system.run.${sub.runId}.step.${stepId}.created`,
    data: {},
  });
}

function deferred<T>() {
  let resolve: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve: (value: T) => resolve(value) };
}

it("renders a step replayed after invocation completes", async () => {
  await run();
  expect(container.textContent).toContain("COMPLETED");
  expect(subscriptions[0].unsubscribe).not.toHaveBeenCalled();
  await act(async () => step(0, "tool.ocr"));
  expect(container.querySelector("li")?.textContent).toBe("tool.ocr — created");
});

it("closes the subscription on the replayed terminal event and keeps the steps", async () => {
  await run();
  await act(async () => {
    step(0, "tool.ocr");
    subscriptions[0].callbacks.onComplete?.({ output: {} });
  });
  expect(subscriptions[0].unsubscribe).toHaveBeenCalledTimes(1);
  expect(container.querySelector("li")?.textContent).toBe("tool.ocr — created");
});

it("replays steps for a failed run", async () => {
  vi.mocked(ironflow.agents.invoke).mockRejectedValueOnce(
    Object.assign(new Error("classify failed"), { name: "RunFailedError", runId: "run-9" })
  );
  await run();
  expect(container.textContent).toContain("FAILED");
  expect(container.textContent).toContain("run-9");
  expect(subscriptions[0].runId).toBe("run-9");
  await act(async () => step(0, "tool.classify"));
  expect(container.querySelector("li")?.textContent).toBe("tool.classify — created");
});

it("keeps replaying steps after a beforeunload that does not unload", async () => {
  await run();
  await act(async () => window.dispatchEvent(new Event("beforeunload")));
  await act(async () => step(0, "tool.ocr"));
  expect(subscriptions[0].unsubscribe).not.toHaveBeenCalled();
  expect(container.querySelector("li")?.textContent).toBe("tool.ocr — created");
});

it("replaces the old subscription and ignores its late steps", async () => {
  await run();
  const pending = deferred<Awaited<ReturnType<typeof ironflow.agents.invoke>>>();
  vi.mocked(ironflow.agents.invoke).mockReturnValueOnce(pending.promise);
  await run();
  await act(async () => step(0, "old-step"));
  expect(container.querySelectorAll("li")).toHaveLength(0);
  await act(async () => pending.resolve({ runId: "run-2", durationMs: 1, output: {} }));
  await act(async () => {
    step(0, "old-step");
    step(1, "tool.classify");
  });
  expect(subscriptions[0].unsubscribe).toHaveBeenCalledTimes(1);
  expect(Array.from(container.querySelectorAll("li"), (row) => row.textContent)).toEqual([
    "tool.classify — created",
  ]);
});

it("closes a subscription that resolves after unmount", async () => {
  const pending = deferred<Awaited<ReturnType<typeof ironflow.agents.subscribe>>>();
  vi.mocked(ironflow.agents.subscribe).mockReturnValueOnce(pending.promise);
  await run();
  expect(container.textContent).toContain("COMPLETED");
  await act(async () => root.unmount());
  const unsubscribe = vi.fn();
  await act(async () => pending.resolve({
    id: "run-1",
    pattern: "system.run.run-1.>",
    connectionState: "connected",
    unsubscribe,
  }));
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

it("closes the replay subscription on unmount", async () => {
  await run();
  expect(subscriptions[0].unsubscribe).not.toHaveBeenCalled();
  await act(async () => root.unmount());
  expect(subscriptions[0].unsubscribe).toHaveBeenCalledTimes(1);
});
