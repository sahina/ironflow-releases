import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createClient } from "@ironflow/node";
import { startEngine, waitFor } from "../../../apps/dashboard/e2e/support/engine.ts";
import { crashCommand } from "./crash-command.mts";

function startWorker(url: string, boundary: string) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(IRONFLOW_|NATS_)/.test(key)));
  const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./crash-worker.ts", import.meta.url)), boundary], {
    env: { ...env, IRONFLOW_SERVER_URL: url, IRONFLOW_API_KEY: "", IRONFLOW_NO_DISCOVERY: "1" },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let output = "";
  child.stdout?.on("data", (data: Buffer) => { output = (output + data.toString()).slice(-8000); });
  child.stderr?.on("data", (data: Buffer) => { output = (output + data.toString()).slice(-8000); });
  return { child, output: () => output };
}

async function stopWorker(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
}

for (const boundary of ["after-claim", "after-append"]) {
  test(`recovers the original run after SIGKILL ${boundary} and a new-run retry`, { timeout: 240_000 }, async () => {
    const engine = await startEngine("dev");
    const client = createClient({ serverUrl: engine.url, apiKey: "" });
    const workers: ReturnType<typeof startWorker>[] = [];
    try {
      const first = startWorker(engine.url, boundary);
      workers.push(first);
      await waitFor(() => first.output().includes("Connected to server") ? true : undefined, 30_000, "worker registration");
      const orderId = `o-${randomUUID()}`;
      const commandId = randomUUID();
      const command = crashCommand(orderId, commandId);
      let signal: unknown;
      first.child.on("message", (message: unknown) => { signal = message; });
      const emitted = await client.emit("cqrs.crash.create-order", command);
      const originalRunId = emitted.runIds[0];
      assert.ok(originalRunId);
      await waitFor(() => signal, 30_000, "crash boundary");
      assert.deepEqual(signal, { boundary, runId: originalRunId });
      const before = await client.streams.read(orderId);
      assert.equal(before.events.length, boundary === "after-claim" ? 0 : 1);
      await stopWorker(first.child);
      assert.equal(first.child.signalCode, "SIGKILL");

      const replacement = startWorker(engine.url, "none");
      workers.push(replacement);
      const completed = await waitFor(async () => {
        const run = await client.getRun(originalRunId);
        if (run.status === "failed") throw new Error(JSON.stringify(run.error));
        return run.status === "completed" ? run : undefined;
      }, 180_000, "original run recovery");
      assert.equal(completed.id, originalRunId);
      assert.deepEqual(completed.output, { orderId, entityVersion: 1, dedup: boundary === "after-append" });

      const repeated = await client.emit("cqrs.crash.create-order", command);
      const newRunId = repeated.runIds[0];
      assert.ok(newRunId);
      assert.notEqual(newRunId, originalRunId);
      const retried = await waitFor(async () => {
        const run = await client.getRun(newRunId);
        if (run.status === "failed") throw new Error(JSON.stringify(run.error));
        return run.status === "completed" ? run : undefined;
      }, 30_000, "new run completion");
      assert.deepEqual(retried.output, { orderId, entityVersion: 1, dedup: true });
      const after = await client.streams.read(orderId);
      assert.equal(after.events.length, 1);
      assert.equal(after.events[0]?.name, "order.placed");
      assert.equal(after.events[0]?.metadata?.causationId, commandId);
      const cached = await client.kv().bucket("order-commands").get(commandId);
      assert.ok(typeof cached.value === "string");
      const entry: unknown = JSON.parse(Buffer.from(cached.value, "base64").toString("utf8"));
      assert.ok(typeof entry === "object" && entry !== null && "entityVersion" in entry);
      assert.equal(entry.entityVersion, 1);
    } catch (error) {
      for (const worker of workers) console.error(worker.output());
      throw error;
    } finally {
      for (const worker of workers) await stopWorker(worker.child);
      await engine.stop();
    }
  });
}
