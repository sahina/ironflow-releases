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
// /ready plus the schema list the service readiness probes read. The fake
// answers as though both publishers had already registered, which is what
// FAKE_SERVICE stands in for.
const schemas = JSON.stringify({ schemas: [{ event_name: "order.placed", version: 1 }, { event_name: "payment.authorized", version: 1 }] });
const server = createServer((req, res) => {
  if (req.url === "/ready") { res.writeHead(200); return res.end(); }
  if (req.url === "/api/v1/events/schemas") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(schemas);
  }
  // The payment row's readiness probe asks whether a worker running its
  // function has heartbeated recently. Answered fresh on every request: the
  // probe checks the age, so a fixed timestamp would go stale mid-suite.
  if (req.url === "/api/v1/workers") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ workers: [
      { id: "fake-orders", function_ids: ["place-order"], last_heartbeat: new Date().toISOString() },
      { id: "fake-worker", function_ids: ["process-payment"], last_heartbeat: new Date().toISOString() },
    ] }));
  }
  // The notifications row's readiness probe reads a KV heartbeat, because a
  // client-only subscriber registers no worker. Answered fresh on every
  // request, for the same reason as the worker list above.
  if (req.url.startsWith("/api/v1/kv/buckets/reference-app/keys/notifications-heartbeat")) {
    const beat = JSON.stringify({ service: "notifications-python", at: new Date().toISOString() });
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ key: "notifications-heartbeat", value: Buffer.from(beat).toString("base64"), revision: 1 }));
  }
  res.writeHead(404); res.end();
});
server.listen(0, flag("--host"), () => {
  process.stdout.write("fake engine pid=" + process.pid + "\\n");
  // Proves the scrubbed environment: an ambient database URL must not arrive.
  process.stdout.write("saw-db-url=" + (process.env.IRONFLOW_DATABASE_URL ? "yes" : "no") + "\\n");
  writeFileSync(flag("--port-file"), JSON.stringify({ http_port: server.address().port }));
});
`;

// A service child that does nothing but stay up, so the supervisor's ordering,
// crash and shutdown paths can be tested without building a Go binary.
const FAKE_SERVICE = `#!/usr/bin/env node
import { createServer } from "node:http";
process.stdout.write("fake service pid=" + process.pid + "\\n");
// A row given --port is a server row (the web application); one without is a
// worker. The same double covers both.
const portFlag = process.argv.indexOf("--port");
if (portFlag !== -1) {
  createServer((_req, res) => { res.writeHead(200); res.end("<html>fake web</html>"); })
    .listen(Number(process.argv[portFlag + 1]), "127.0.0.1");
} else {
  setInterval(() => {}, 1000);
}
`;

// Same double, with nothing registered. Like FAILING_ENGINE this has to be its
// own script rather than a flag: dev.mjs hands the engine a scrubbed
// environment, so no FAKE_ENGINE_* variable would reach it.
const UNREGISTERED_ENGINE = FAKE_ENGINE.replace(
  '[{ event_name: "order.placed", version: 1 }, { event_name: "payment.authorized", version: 1 }]',
  "[]",
);

function scratch({ fail = false, unregistered = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "refapp-dev-"));
  const binary = join(root, "fake-ironflow.mjs");
  const ordersBinary = join(root, "fake-orders.mjs");
  const dataDir = join(root, "examples", "reference-app", ".data");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(binary, fail ? FAILING_ENGINE : unregistered ? UNREGISTERED_ENGINE : FAKE_ENGINE, { mode: 0o755 });
  writeFileSync(ordersBinary, FAKE_SERVICE, { mode: 0o755 });
  return {
    root,
    dataDir,
    supervisorFile: join(dataDir, "supervisor.json"),
    env: {
      ...process.env,
      REFERENCE_APP_IRONFLOW_BIN: binary,
      REFERENCE_APP_ORDERS_BIN: ordersBinary,
      // The payment row runs `node <script>`, so the same double serves it.
      REFERENCE_APP_PAYMENTS_BIN: ordersBinary,
      // The notifications row runs `<interpreter> -m reference_notifications.main`.
      // The double ignores its arguments, so it stands in here too.
      REFERENCE_APP_NOTIFICATIONS_BIN: ordersBinary,
      REFERENCE_APP_WEB_BIN: ordersBinary,
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

  // The crash control authenticates, and answers a target that is not a
  // supervised service with a clear message rather than a stack trace.
  await assert.rejects(
    sendControl("crash", "engine", { file: supervisorFile }),
    /engine is not a crashable service/,
  );
  await assert.rejects(
    sendControl("crash", "notifications", { file: supervisorFile }),
    /notifications is not a crashable service/,
  );
  await assert.rejects(
    sendControl("crash", "nothing-here", { file: supervisorFile }),
    /no such service: nothing-here/,
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
  // Only the payment worker may be crashed. A real but protected service and an
  // unknown name are refused differently, and both refusals matter: the crash
  // control must never reach the engine, the ordering service or the subscriber.
  assert.equal(
    await sendControl("crash", "notifications", { file: supervisorFile }).catch((e) => e.message),
    "notifications is not a crashable service",
  );
  assert.equal(
    await sendControl("crash", "orders", { file: supervisorFile }).catch((e) => e.message),
    "orders is not a crashable service",
  );
  assert.equal(
    await sendControl("crash", "nothing-here", { file: supervisorFile }).catch((e) => e.message),
    "no such service: nothing-here",
  );

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

test("the ordering service runs as a supervised child", async (t) => {
  const { root, env } = scratch();
  const dev = startDev(env);
  t.after(() => {
    dev.child.kill("SIGKILL");
    rmSync(root, { recursive: true, force: true });
  });

  // Waited for, not asserted by position: child output reaches this pipe
  // asynchronously, so the printed order proves nothing. The test below is
  // what pins ready behind the ordering service.
  await dev.until(/\[orders]\s+fake service pid=/);
  await dev.until(/\[dev]\s+ready\n/);

  dev.child.kill("SIGINT");
  await dev.exited;
});

// "Ready" has to mean the contract is enforceable. A supervisor that reports
// ready before the schemas exist lets the first order through unvalidated.
test("ready waits for the ordering schemas, not just for the process", async (t) => {
  const { root, env } = scratch({ unregistered: true });
  const dev = startDev(env);
  t.after(() => {
    dev.child.kill("SIGKILL");
    rmSync(root, { recursive: true, force: true });
  });

  await dev.until(/fake service pid=/);
  // Sampled across the window rather than checked once after a sleep: a
  // regression that reports ready early would slip past a single late look.
  const deadline = Date.now() + 1_500;
  while (Date.now() < deadline) {
    assert.ok(!/\[dev]\s+ready\n/.test(dev.text()), `reported ready with no schemas registered:\n${dev.text()}`);
    await sleep(100);
  }

  dev.child.kill("SIGINT");
  await dev.exited;
});

test("the web application is started and its URL is printed once", async (t) => {
  const { root, env } = scratch();
  const dev = startDev(env);
  t.after(() => {
    dev.child.kill("SIGKILL");
    rmSync(root, { recursive: true, force: true });
  });

  const output = await dev.until(/\[dev]\s+ready\n/);
  // A presenter reads the URL off this line; nothing else tells them the port.
  const web = output.match(/web\s+(http:\/\/127\.0\.0\.1:\d+)\/shop/);
  assert.ok(web, `no web URL in:\n${output}`);
  // And the port really is serving, not just chosen.
  assert.equal((await fetch(`${web[1]}/shop`)).status, 200);

  dev.child.kill("SIGINT");
  await dev.exited;
});

// The one caller of REFERENCE_APP_SKIP_WEB is the load gate: `next dev` logs
// every request and the pages poll the whole read model every 2s, which on a
// run placing hundreds of orders is a second client competing for the engine
// the gate is measuring. A presenter never sets it.
test("REFERENCE_APP_SKIP_WEB starts the services without the web application", async (t) => {
  const { root, env } = scratch();
  const dev = startDev({ ...env, REFERENCE_APP_SKIP_WEB: "1" });
  t.after(() => {
    dev.child.kill("SIGKILL");
    rmSync(root, { recursive: true, force: true });
  });

  // Ready still means the other three are up, not that startup was skipped.
  // Awaited one at a time rather than asserted against the snapshot `ready`
  // returns: a child's piped stdout and the supervisor's own stderr reach this
  // buffer independently, so the line can land just after the ready line does.
  await dev.until(/\[dev]\s+ready\n/);
  for (const label of ["orders", "payments", "notifications"]) {
    await dev.until(new RegExp(`\\[${label}]\\s+fake service pid=`));
  }
  // Safe as an instant check, unlike the three above: `ready` is printed only
  // after every row has started, so no further child can appear after it.
  const output = dev.text();
  assert.ok(!/\[web]/.test(output), `the web application was started anyway:\n${output}`);
  // And no URL is printed for a process that is not there.
  assert.ok(!/web\s+http:\/\//.test(output), `a web URL was printed:\n${output}`);

  dev.child.kill("SIGINT");
  await dev.exited;
});

// The presenter control the crash-and-resume demonstration turns on. It kills
// only the payment worker and brings it back; the engine and the other children
// keep running, which is what makes durable replay the visible cause of the
// order completing.
test("the crash control restarts only the payment worker", async (t) => {
  const { root, supervisorFile, env } = scratch();
  const dev = startDev(env);
  t.after(() => {
    dev.child.kill("SIGKILL");
    rmSync(root, { recursive: true, force: true });
  });
  await dev.until(/\[dev]\s+ready\n/);

  const pidsOf = (label) =>
    [...dev.text().matchAll(new RegExp(`\\[${label}]\\s+fake service pid=(\\d+)`, "g"))].map((m) => Number(m[1]));
  const [crashed] = pidsOf("payments");
  const ordersBefore = pidsOf("orders");
  assert.ok(crashed > 0, `no payments pid in:\n${dev.text()}`);

  const message = await sendControl("crash", "payments", { file: supervisorFile });
  assert.match(message, /payments crashed \(SIGKILL\) and restarted/);

  await waitUntil(() => pidsOf("payments").length === 2, "the payment worker to come back");
  const [, restarted] = pidsOf("payments");
  assert.notEqual(restarted, crashed);
  await waitUntil(() => {
    try {
      process.kill(crashed, 0);
      return false;
    } catch {
      return true;
    }
  }, "the crashed payment worker to be gone");
  // Only payments. A crash control that took the engine or the ordering service
  // with it would make the demonstration prove nothing.
  assert.deepEqual(pidsOf("orders"), ordersBefore);
  assert.doesNotThrow(() => process.kill(Number(/fake engine pid=(\d+)/.exec(dev.text())[1]), 0));

  dev.child.kill("SIGINT");
  await dev.exited;
});

// The guards that name the build command. Without them a missing binary
// surfaces as an exec failure inside a child, which reads as a supervisor bug
// rather than "you did not build it".
test("a missing service binary names the command that builds it", async (t) => {
  const { root, env } = scratch();
  const dev = startDev({ ...env, REFERENCE_APP_ORDERS_BIN: join(root, "not-built") });
  t.after(() => {
    dev.child.kill("SIGKILL");
    rmSync(root, { recursive: true, force: true });
  });

  assert.equal(await dev.exited, 1);
  assert.match(dev.text(), /no ordering binary at .*not-built — start the example with `make reference-app`/);
});

test("a missing payment worker build names the command that builds it", async (t) => {
  const { root, env } = scratch();
  const dev = startDev({ ...env, REFERENCE_APP_PAYMENTS_BIN: join(root, "not-built") });
  t.after(() => {
    dev.child.kill("SIGKILL");
    rmSync(root, { recursive: true, force: true });
  });

  assert.equal(await dev.exited, 1);
  assert.match(dev.text(), /no payment worker at .*not-built — start the example with `make reference-app`/);
});

test("a missing web toolchain names the install command", async (t) => {
  const { root, env } = scratch();
  const dev = startDev({ ...env, REFERENCE_APP_WEB_BIN: join(root, "no-next") });
  t.after(() => {
    dev.child.kill("SIGKILL");
    rmSync(root, { recursive: true, force: true });
  });

  assert.equal(await dev.exited, 1);
  assert.match(dev.text(), /no web toolchain at .*no-next — run `pnpm -C examples\/reference-app install`/);
});
