import { strict as assert } from "node:assert";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import { engineApi, startSupervisor } from "./live.mjs";

// Keep the harness real, but control the process boundary so separate stdout
// chunks deterministically reproduce a ready line arriving before the banner.
function supervisorOutput(t) {
  t.mock.property(process, "env", { ...process.env, LIVE_DB: "", REFERENCE_APP_SKIP_WEB: "" });
  const dataDir = mkdtempSync(join(tmpdir(), "refapp-live-"));
  writeFileSync(join(dataDir, "port.json"), JSON.stringify({ http_port: 9123 }));
  writeFileSync(join(dataDir, "bootstrap-key.json"), JSON.stringify({ key: "test-key" }));
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const spawn = t.mock.method(childProcess, "spawn", () => child);
  syncBuiltinESMExports();
  t.after(() => {
    child.emit("close", 0);
    spawn.mock.restore();
    syncBuiltinESMExports();
    rmSync(dataDir, { recursive: true, force: true });
  });
  return { dataDir, write: (chunk) => child.stdout.emit("data", chunk) };
}

test("startSupervisor waits for a web URL that arrives after ready in separate chunks", async (t) => {
  const { dataDir, write } = supervisorOutput(t);
  const startup = startSupervisor({ dataDir, readyTimeoutMs: 2_000 });
  write("[dev]        ready\n");
  assert.equal(await Promise.race([startup.then(() => true), sleep(300).then(() => false)]), false,
    "ready alone must not return a supervisor with no web URL");
  write("[dev]          web        http://127.0.0.1:35");
  write("365/shop\n");
  const supervisor = await startup;
  assert.equal(supervisor.webUrl, "http://127.0.0.1:35365");
  assert.equal(supervisor.url, "http://127.0.0.1:9123");
});

test("startSupervisor times out when ready arrives but the web URL never does", async (t) => {
  const { dataDir, write } = supervisorOutput(t);
  const startup = startSupervisor({ dataDir, readyTimeoutMs: 250 });
  write("[dev]        ready\n");
  await assert.rejects(startup, /the supervisor was not ready within 250ms/);
});

test("startSupervisor needs no web URL when the web service is explicitly skipped", async (t) => {
  const { dataDir, write } = supervisorOutput(t);
  const startup = startSupervisor({ dataDir, env: { REFERENCE_APP_SKIP_WEB: "1" } });
  write("[dev]        ready\n");
  const supervisor = await startup;
  assert.equal(supervisor.webUrl, undefined);
  assert.equal(supervisor.port, 9123);
});

test("projectedOrders sends one valid JSON content type", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url, options) => {
    assert.equal(url, "http://engine/ironflow.v1.ProjectionService/GetProjection");
    assert.deepEqual(
      Object.keys(options.headers).filter((name) => name.toLowerCase() === "content-type"),
      ["content-type"],
    );
    assert.equal(options.headers["content-type"], "application/json");
    assert.deepEqual(JSON.parse(options.body), { name: "orders" });
    return new Response(JSON.stringify({ state: { orders: { "order-1": { status: "pending_approval" } } } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const orders = await engineApi({ url: "http://engine", apiKey: "test-key" }).projectedOrders();
  assert.deepEqual(orders, { "order-1": { status: "pending_approval" } });
});
