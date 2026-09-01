#!/usr/bin/env node
// The live gate: the supervisor humans use, driving the real engine binary.
//
// It runs against a fresh data directory under .data/, so it never disturbs a
// demo's history, and `make reference-app-reset` still cleans up after it.
//
// Today it proves the boot contract this slice delivers: the real binary starts
// on a discovered port, serves the embedded dashboard, publishes an
// authenticated control handshake and leaves nothing behind on shutdown. The
// Chromium happy path and the crash proof join it as their services land
// (#1894 tasks 6 and 12).
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { APP_DIR, DATA_DIR, sendControl } from "./lib/control.mjs";

const DEV = fileURLToPath(new URL("./dev.mjs", import.meta.url));
const LIVE_DATA = join(DATA_DIR, "live-test");
const SUPERVISOR_FILE = join(LIVE_DATA, "supervisor.json");
const READY_TIMEOUT_MS = 180_000;

let output = "";
const check = async (what, fn) => {
  try {
    await fn();
  } catch (error) {
    error.message = `${what}: ${error.message}`; // name the failing step
    throw error;
  }
  process.stdout.write(`  ok  ${what}\n`);
};

// The engine prints the throwaway dashboard admin password on first boot, and
// this gate starts from a fresh directory every run. Keep it out of CI logs.
const redact = (text) => text.replace(/Password:.*/g, "Password: [redacted]");

async function main() {
  // A fresh directory: the boot path under test includes first-boot bootstrap.
  rmSync(LIVE_DATA, { recursive: true, force: true });

  const dev = spawn(process.execPath, [DEV], {
    cwd: APP_DIR,
    env: { ...process.env, REFERENCE_APP_DATA_DIR: LIVE_DATA, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    // Own process group: on the failure path below, killing the supervisor's
    // PID alone would leave its engine running, holding LIVE_DATA and a port
    // for the rest of the CI job.
    detached: true,
  });
  dev.stdout.on("data", (c) => (output += c));
  dev.stderr.on("data", (c) => (output += c));
  // "close", not "exit": exit can fire before the last stdout chunk arrives, and
  // the ready loop below would then report a ready supervisor as having died.
  const exited = new Promise((resolve) => dev.on("close", (code) => resolve(code)));

  try {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    let running = true;
    exited.then(() => (running = false));
    while (!/\[dev]\s+ready\n/.test(output)) {
      if (!running) throw new Error("the supervisor exited before it was ready");
      if (Date.now() > deadline) throw new Error(`the supervisor was not ready within ${READY_TIMEOUT_MS}ms`);
      await sleep(200);
    }

    const { http_port: port } = JSON.parse(readFileSync(join(LIVE_DATA, "port.json"), "utf8"));
    const url = `http://127.0.0.1:${port}`;

    await check("the engine reports ready on a discovered port", async () => {
      assert.ok(port > 0);
      assert.equal((await fetch(`${url}/ready`)).status, 200);
    });

    await check("the embedded dashboard is served", async () => {
      const response = await fetch(url);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /<html/i);
    });

    await check("the control plane authenticates and refuses a service that is not running", async () => {
      await assert.rejects(sendControl("crash", "payments", { file: SUPERVISOR_FILE }), /no such service/);
      // The token is the credential, not the loopback port.
      const meta = JSON.parse(readFileSync(SUPERVISOR_FILE, "utf8"));
      const forged = await fetch(`http://127.0.0.1:${meta.port}/control`, {
        method: "POST",
        headers: { authorization: "Bearer forged" },
        body: "{}",
      });
      assert.equal(forged.status, 401);
    });

    process.kill(-dev.pid, "SIGINT");
    await check("shutdown leaves no engine and no handshake file", async () => {
      assert.equal(await exited, 0);
      assert.equal(existsSync(SUPERVISOR_FILE), false);
      await assert.rejects(fetch(`${url}/ready`), "the engine still answers after shutdown");
    });

    process.stdout.write("reference-app live gate passed\n");
    // Clean only on success: a failed run leaves its engine database and logs
    // behind on purpose, for whoever has to work out what happened.
    rmSync(LIVE_DATA, { recursive: true, force: true });
  } catch (error) {
    // Ask the supervisor to stop its children, then take the whole group.
    try {
      process.kill(-dev.pid, "SIGINT");
      await Promise.race([exited, sleep(10_000)]);
    } catch {
      // already gone
    }
    try {
      process.kill(-dev.pid, "SIGKILL");
    } catch {
      // already gone
    }
    process.stderr.write(`\nreference-app live gate FAILED: ${error.message}\n\n--- supervisor log ---\n${redact(output)}\n`);
    process.stderr.write(`state kept at ${LIVE_DATA}\n`);
    process.exitCode = 1;
  }
}

await main();
