import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  APP_DIR,
  DATA_DIR,
  assertResettable,
  isPidLive,
  readSupervisorFile,
  sendControl,
  startControlServer,
  writeSupervisorFile,
} from "./control.mjs";

// A PID that is almost certainly free. 0x7FFFFFFF is above every default
// pid_max, so process.kill reports it as gone rather than as someone else's.
const DEAD_PID = 0x7fffffff;

function tempApp() {
  const root = mkdtempSync(join(tmpdir(), "refapp-"));
  const dir = join(root, "examples", "reference-app", ".data");
  mkdirSync(dir, { recursive: true });
  return { root, dir, supervisorFile: join(dir, "supervisor.json") };
}

test("paths resolve to this example, not to the caller's working directory", () => {
  assert.equal(APP_DIR.endsWith("/examples/reference-app"), true);
  assert.equal(DATA_DIR, join(APP_DIR, ".data"));
});

test("isPidLive sees this process and not a dead one", () => {
  assert.equal(isPidLive(process.pid), true);
  assert.equal(isPidLive(DEAD_PID), false);
  assert.equal(isPidLive(0), false);
});

test("the supervisor file is owner-only and round-trips", () => {
  const { root, supervisorFile } = tempApp();
  try {
    writeSupervisorFile({ port: 1234, token: "abc", file: supervisorFile });
    assert.equal(statSync(supervisorFile).mode & 0o777, 0o600);
    assert.deepEqual(readSupervisorFile(supervisorFile), { pid: process.pid, port: 1234, token: "abc" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a missing supervisor file says how to start it", () => {
  assert.throws(() => readSupervisorFile("/nonexistent/supervisor.json"), /is `make reference-app` running\?/);
});

test("stale supervisor metadata is rejected rather than dialed", () => {
  const { root, supervisorFile } = tempApp();
  try {
    writeFileSync(supervisorFile, JSON.stringify({ pid: DEAD_PID, port: 1, token: "t" }));
    assert.throws(() => readSupervisorFile(supervisorFile), /stale supervisor metadata/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the control server runs an authenticated action and refuses everything else", async () => {
  const seen = [];
  const control = await startControlServer({
    actions: {
      crash: async (target) => {
        if (target !== "payments") throw new Error(`no such service: ${target}`);
        seen.push(target);
        return "payments crashed and restarted";
      },
    },
  });
  const url = `http://127.0.0.1:${control.port}/control`;
  const post = (headers, body) => fetch(url, { method: "POST", headers, body });
  const auth = { authorization: `Bearer ${control.token}`, "content-type": "application/json" };
  try {
    const ok = await post(auth, JSON.stringify({ action: "crash", target: "payments" }));
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { message: "payments crashed and restarted" });
    assert.deepEqual(seen, ["payments"]);

    assert.equal((await post({ authorization: "Bearer wrong" }, "{}")).status, 401);
    assert.equal((await post({}, "{}")).status, 401);
    assert.equal((await post(auth, "not json")).status, 400);
    assert.equal((await post(auth, JSON.stringify({ action: "rm -rf" }))).status, 400);
    assert.equal((await fetch(`http://127.0.0.1:${control.port}/`)).status, 404);

    // An action that cannot run right now is a 409 with the reason, not a crash.
    const conflict = await post(auth, JSON.stringify({ action: "crash", target: "orders" }));
    assert.equal(conflict.status, 409);
    assert.deepEqual(await conflict.json(), { error: "no such service: orders" });
  } finally {
    await control.close();
  }
});

test("sendControl carries the token from the supervisor file end to end", async () => {
  const { root, supervisorFile } = tempApp();
  const control = await startControlServer({ actions: { crash: async (t) => `crashed ${t}` } });
  try {
    writeSupervisorFile({ port: control.port, token: control.token, file: supervisorFile });
    assert.equal(await sendControl("crash", "payments", { file: supervisorFile }), "crashed payments");
    // The token in the file is the only credential; nothing else is accepted.
    const meta = JSON.parse(readFileSync(supervisorFile, "utf8"));
    writeFileSync(supervisorFile, JSON.stringify({ ...meta, token: "forged" }));
    await assert.rejects(sendControl("crash", "payments", { file: supervisorFile }), /bad control token/);
  } finally {
    await control.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("assertResettable accepts only examples/reference-app/.data", () => {
  const { root, dir } = tempApp();
  try {
    // realpathSync: on macOS the temp dir lives behind /private, and the guard
    // deliberately reports the resolved path it would delete.
    assert.deepEqual(assertResettable(dir, { supervisorFile: join(dir, "none.json") }), {
      exists: true,
      dir: realpathSync(dir),
    });
    for (const bad of [root, join(root, "examples"), join(root, "examples", "reference-app"), "/", process.env.HOME]) {
      assert.throws(() => assertResettable(bad), /refusing to reset/, `should refuse ${bad}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("assertResettable refuses a symlinked data directory", () => {
  const { root, dir } = tempApp();
  const elsewhere = mkdtempSync(join(tmpdir(), "refapp-target-"));
  try {
    rmSync(dir, { recursive: true, force: true });
    symlinkSync(elsewhere, dir);
    assert.throws(() => assertResettable(dir), /it is a symlink/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

test("assertResettable refuses to delete data a live supervisor is using", () => {
  const { root, dir, supervisorFile } = tempApp();
  try {
    writeFileSync(supervisorFile, JSON.stringify({ pid: process.pid, port: 1, token: "t" }));
    assert.throws(() => assertResettable(dir, { supervisorFile }), /the reference app is running/);

    // A supervisor file left behind by a crashed run must not block a reset.
    writeFileSync(supervisorFile, JSON.stringify({ pid: DEAD_PID, port: 1, token: "t" }));
    assert.equal(assertResettable(dir, { supervisorFile }).exists, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("assertResettable reports a data directory that was never created", () => {
  const { root, dir } = tempApp();
  try {
    rmSync(dir, { recursive: true, force: true });
    assert.deepEqual(assertResettable(dir, { supervisorFile: join(dir, "none.json") }), { exists: false, dir });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
