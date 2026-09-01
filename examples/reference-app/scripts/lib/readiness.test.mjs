import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { waitFor, waitForHttpOk, waitForJsonFile } from "./readiness.mjs";

test("waitFor returns the first truthy probe result", async () => {
  let calls = 0;
  const value = await waitFor("a value", () => (++calls < 3 ? null : "here"), { intervalMs: 1 });
  assert.equal(value, "here");
  assert.equal(calls, 3);
});

test("waitFor names what it was waiting for and why the last attempt failed", async () => {
  await assert.rejects(
    waitFor("the engine", () => {
      throw new Error("ECONNREFUSED");
    }, { timeoutMs: 20, intervalMs: 1 }),
    /timed out after 20ms waiting for the engine: ECONNREFUSED/,
  );
});

test("waitForJsonFile discovers a port file written after the wait begins", async () => {
  const dir = mkdtempSync(join(tmpdir(), "refapp-"));
  const file = join(dir, "port.json");
  try {
    const pending = waitForJsonFile(file, { timeoutMs: 2000, intervalMs: 5 });
    // A torn read first (the engine writes the port file non-atomically), then
    // the complete document.
    setTimeout(() => writeFileSync(file, '{"http_p'), 20);
    setTimeout(() => writeFileSync(file, '{"http_port":54321}'), 60);
    assert.deepEqual(await pending, { http_port: 54321 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("waitForJsonFile times out when the port file never appears", async () => {
  await assert.rejects(
    waitForJsonFile("/nonexistent/port.json", { timeoutMs: 20, intervalMs: 1 }),
    /timed out after 20ms waiting for \/nonexistent\/port.json/,
  );
});

test("waitForHttpOk polls past non-2xx responses", async () => {
  let calls = 0;
  const fetchImpl = async () => ({ ok: ++calls >= 3, status: calls >= 3 ? 200 : 503 });
  assert.equal(await waitForHttpOk("http://x/ready", { fetchImpl, intervalMs: 1 }), true);
  assert.equal(calls, 3);
});

test("waitForHttpOk reports the last status on timeout", async () => {
  const fetchImpl = async () => ({ ok: false, status: 503 });
  await assert.rejects(
    waitForHttpOk("http://x/ready", { fetchImpl, timeoutMs: 20, intervalMs: 1 }),
    /waiting for http:\/\/x\/ready: HTTP 503/,
  );
});
