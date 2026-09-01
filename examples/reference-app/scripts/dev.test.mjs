// End-to-end supervisor tests against a fake engine.
//
// The fake stands in for `ironflow serve`: it takes the same flags, binds an
// ephemeral port, writes the same port file and bootstrap key file, and answers
// /ready. That is the whole contract dev.mjs depends on, so these tests cover
// port-file discovery, ordered readiness, the control handshake and signal
// forwarding without a 60-second engine boot in the fast gate.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

import { sendControl } from "./lib/control.mjs";
import { buildChildEnv } from "./dev.mjs";

const DEV = fileURLToPath(new URL("./dev.mjs", import.meta.url));

async function waitUntil(probe, what, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (probe()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(20);
  }
}

// The failure double cannot be a flag on the working one: dev.mjs hands the
// engine a scrubbed environment, so no FAKE_ENGINE_* variable would reach it.
const FAILING_ENGINE = `#!/usr/bin/env node
process.stderr.write("boot failed\\n");
process.exit(1);
`;

const FAKE_ENGINE = `#!/usr/bin/env node
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
const flag = (name) => process.argv[process.argv.indexOf(name) + 1];
writeFileSync(flag("--bootstrap-key-file"), JSON.stringify({ key: "ifkey_fake", key_id: "ak_fake" }), { mode: 0o400 });
const server = createServer((req, res) => { res.writeHead(req.url === "/ready" ? 200 : 404); res.end(); });
server.listen(0, flag("--host"), () => {
  process.stdout.write("fake engine pid=" + process.pid + "\\n");
  // Proves the scrubbed environment: an ambient database URL must not arrive.
  process.stdout.write("saw-db-url=" + (process.env.IRONFLOW_DATABASE_URL ? "yes" : "no") + "\\n");
  writeFileSync(flag("--port-file"), JSON.stringify({ http_port: server.address().port }));
});
`;

function scratch({ fail = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "refapp-dev-"));
  const binary = join(root, "fake-ironflow.mjs");
  const dataDir = join(root, "examples", "reference-app", ".data");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(binary, fail ? FAILING_ENGINE : FAKE_ENGINE, { mode: 0o755 });
  return {
    root,
    dataDir,
    supervisorFile: join(dataDir, "supervisor.json"),
    env: {
      ...process.env,
      REFERENCE_APP_IRONFLOW_BIN: binary,
      REFERENCE_APP_DATA_DIR: dataDir,
      // A stray value in the developer's shell that must not reach the engine.
      IRONFLOW_DATABASE_URL: "postgres://someone-elses-database",
      NO_COLOR: "1",
    },
  };
}

// Runs dev.mjs, collecting output until `match` appears or it exits.
function startDev(env) {
  const child = spawn(process.execPath, [DEV], { env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (c) => (output += c));
  child.stderr.on("data", (c) => (output += c));
  // "close", not "exit": exit can fire before the last stdout chunk arrives, and
  // `until` below would then report a ready supervisor as having died early.
  const exited = new Promise((resolve) => child.on("close", (code) => resolve(code)));
  return {
    child,
    exited,
    text: () => output,
    async until(pattern, timeoutMs = 15_000) {
      const deadline = Date.now() + timeoutMs;
      let alive = true;
      exited.then(() => (alive = false));
      while (!pattern.test(output)) {
        if (!alive && !pattern.test(output)) throw new Error(`dev.mjs exited before ${pattern}; got:\n${output}`);
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${pattern}; got:\n${output}`);
        await sleep(25);
      }
      return output;
    },
  };
}

test("buildChildEnv overrides ambient engine settings and keeps the rest", () => {
  const env = buildChildEnv({
    url: "http://127.0.0.1:5000",
    apiKey: "ifkey_x",
    dataDir: "/tmp/data",
    env: { PATH: "/bin", IRONFLOW_URL: "http://someone-elses-engine", EDITOR: "vim" },
  });
  assert.equal(env.IRONFLOW_URL, "http://127.0.0.1:5000");
  assert.equal(env.IRONFLOW_SERVER_URL, "http://127.0.0.1:5000");
  assert.equal(env.NEXT_PUBLIC_IRONFLOW_URL, "http://127.0.0.1:5000");
  assert.equal(env.IRONFLOW_API_KEY, "ifkey_x");
  assert.equal(env.IRONFLOW_ENV, "default");
  assert.equal(env.REFERENCE_APP_DATA_DIR, "/tmp/data");
  assert.equal(env.EDITOR, "vim"); // the developer's own settings survive
});

test("the API key never reaches a NEXT_PUBLIC_ variable", () => {
  const env = buildChildEnv({ url: "http://x", apiKey: "ifkey_secret", env: {} });
  const leaked = Object.entries(env).filter(([k, v]) => k.startsWith("NEXT_PUBLIC_") && String(v).includes("ifkey_"));
  assert.deepEqual(leaked, []);
});

test("starts the engine on a discovered port, publishes the control handshake, and shuts down cleanly", async (t) => {
  const { root, dataDir, supervisorFile, env } = scratch();
  const dev = startDev(env);
  t.after(() => {
    dev.child.kill("SIGKILL");
    rmSync(root, { recursive: true, force: true });
  });

  await dev.until(/\[dev]\s+ready\n/);

  // The port came from the engine, not from a constant.
  const port = JSON.parse(readFileSync(join(dataDir, "port.json"), "utf8")).http_port;
  assert.ok(port > 0);
  assert.match(dev.text(), new RegExp(`dashboard  http://127.0.0.1:${port}`));
  assert.match(dev.text(), /saw-db-url=no/, "the engine must not inherit the developer's IRONFLOW_DATABASE_URL");

  // The handshake file is owner-only and names the live supervisor.
  assert.equal(statSync(supervisorFile).mode & 0o777, 0o600);
  const meta = JSON.parse(readFileSync(supervisorFile, "utf8"));
  assert.equal(meta.pid, dev.child.pid);
  assert.ok(meta.port > 0 && meta.token.length >= 32);

  // The crash control authenticates, and answers a target that is not running
  // with a clear message rather than a stack trace.
  await assert.rejects(
    sendControl("crash", "payments", { file: supervisorFile }),
    /no such service: payments/,
  );

  const enginePid = Number(/fake engine pid=(\d+)/.exec(dev.text())[1]);
  dev.child.kill("SIGINT");
  assert.equal(await dev.exited, 0);
  assert.equal(existsSync(supervisorFile), false, "the handshake file must not outlive the supervisor");
  await sleep(200);
  assert.throws(() => process.kill(enginePid, 0), "the engine must not outlive the supervisor");
});

test("an engine that dies before readiness fails startup instead of hanging", async (t) => {
  const { root, supervisorFile, env } = scratch({ fail: true });
  const dev = startDev(env);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  assert.equal(await dev.exited, 1);
  assert.match(dev.text(), /startup failed: engine exited before it was ready \(code 1\)/);
  assert.equal(existsSync(supervisorFile), false);
});

test("a missing engine binary names the build command", async (t) => {
  const { root, supervisorFile, env } = scratch();
  env.REFERENCE_APP_IRONFLOW_BIN = join(root, "not-built");
  const dev = startDev(env);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  assert.equal(await dev.exited, 1);
  assert.match(dev.text(), /no engine binary at .*not-built — run `make embed build`/);
  assert.equal(existsSync(supervisorFile), false);
});

test("a second supervisor refuses rather than corrupting the first's state", async (t) => {
  const { root, dataDir, supervisorFile, env } = scratch();
  const first = startDev(env);
  t.after(() => {
    first.child.kill("SIGKILL");
    rmSync(root, { recursive: true, force: true });
  });
  await first.until(/\[dev]\s+ready\n/);
  const claimed = readFileSync(supervisorFile, "utf8");
  const port = readFileSync(join(dataDir, "port.json"), "utf8");

  const second = startDev(env);
  assert.equal(await second.exited, 1);
  assert.match(second.text(), /another reference app is already running \(pid \d+\)/);
  // The first supervisor's control plane and port are untouched.
  assert.equal(readFileSync(supervisorFile, "utf8"), claimed);
  assert.equal(readFileSync(join(dataDir, "port.json"), "utf8"), port);
  assert.equal(await sendControl("crash", "payments", { file: supervisorFile }).catch((e) => e.message), "no such service: payments");

  first.child.kill("SIGINT");
  await first.exited;
});

test("the data directory is claimed before the engine starts writing to it", async (t) => {
  const { root, supervisorFile, env } = scratch();
  const dev = startDev(env);
  t.after(() => {
    dev.child.kill("SIGKILL");
    rmSync(root, { recursive: true, force: true });
  });
  // Before "ready": the handshake file must already name a live pid, or a
  // concurrent `make reference-app-reset` would delete a booting engine's data.
  await waitUntil(() => existsSync(supervisorFile), "the data directory to be claimed");
  assert.equal(JSON.parse(readFileSync(supervisorFile, "utf8")).pid, dev.child.pid);

  await dev.until(/\[dev]\s+ready\n/);
  dev.child.kill("SIGINT");
  await dev.exited;
});

test("a stale port file from a previous run is not read as this run's port", async (t) => {
  const { root, dataDir, env } = scratch();
  writeFileSync(join(dataDir, "port.json"), JSON.stringify({ http_port: 9 }));
  const dev = startDev(env);
  t.after(() => {
    dev.child.kill("SIGKILL");
    rmSync(root, { recursive: true, force: true });
  });

  await dev.until(/\[dev]\s+ready\n/);
  assert.notEqual(JSON.parse(readFileSync(join(dataDir, "port.json"), "utf8")).http_port, 9);
  dev.child.kill("SIGINT");
  await dev.exited;
});
