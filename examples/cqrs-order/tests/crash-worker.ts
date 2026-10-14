import { createFunction, createWorker } from "@ironflow/node";
import assert from "node:assert/strict";
import { commandDedup } from "../lib/command-dedup";
import { ironflow } from "../lib/ironflow-server";
import { placeOrderHandler } from "../lib/place-order-handler";
import { crashCommand } from "./crash-command.mjs";

const boundary = process.argv[2];
let runId = "";
async function pause() {
  process.send?.({ boundary, runId });
  await new Promise<void>(() => {});
}

if (boundary === "after-claim") {
  const claim = commandDedup.tryClaim;
  commandDedup.tryClaim = async (...args) => {
    const result = await claim(...args);
    await pause();
    return result;
  };
} else if (boundary === "after-append") {
  const append = ironflow.streams.append;
  ironflow.streams.append = async (...args) => {
    const result = await append(...args);
    await pause();
    return result;
  };
}

const fn = createFunction(
  { id: "cqrs-crash-place-order", triggers: [{ event: "cqrs.crash.create-order" }], recording: true },
  async ({ event, step, run }) => {
    runId = run.id;
    const payload = event.data;
    assert.ok(typeof payload === "object" && payload !== null && "data" in payload && "metadata" in payload);
    const { data, metadata } = payload;
    assert.ok(typeof data === "object" && data !== null && "orderId" in data && typeof data.orderId === "string");
    assert.ok(typeof metadata === "object" && metadata !== null && "commandId" in metadata && typeof metadata.commandId === "string");
    const command = crashCommand(data.orderId, metadata.commandId);
    return step.run("handle-place-order", () => placeOrderHandler(command));
  },
);
const worker = createWorker({ serverUrl: process.env.IRONFLOW_SERVER_URL, functions: [fn] });
worker.start().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
