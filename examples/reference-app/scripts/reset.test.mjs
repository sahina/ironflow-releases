// The delete command, executed for real.
//
// assertResettable is unit-tested in lib/control.test.mjs; this file runs
// reset.mjs itself, because a guard that returns the right verdict is worthless
// if the command acts on a different path. The scripts are copied into a temp
// `examples/reference-app/` and run from there — APP_DIR derives from the
// script's own location, so the copy targets the temp `.data` and can never
// reach this repository's.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const DEAD_PID = 0x7fffffff;

// A sandbox that mirrors the real layout, so the guard's basename chain passes.
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "refapp-reset-"));
  const app = join(root, "examples", "reference-app");
  const data = join(app, ".data");
  mkdirSync(data, { recursive: true });
  cpSync(SCRIPTS, join(app, "scripts"), { recursive: true });
  writeFileSync(join(data, "ironflow.db"), "engine history");
  // A sibling that must survive: proof the delete is scoped to .data.
  writeFileSync(join(app, "README.md"), "must survive");
  return { root, app, data, reset: join(app, "scripts", "reset.mjs") };
}

// execFile with an argv array — no shell, nothing interpolated into a command string.
const runReset = (file) => run(process.execPath, [file]).catch((error) => error);

test("reset deletes the data directory and nothing beside it", async () => {
  const { root, app, data, reset } = sandbox();
  try {
    const result = await runReset(reset);
    assert.equal(result.code, undefined, `reset failed: ${result.stderr ?? ""}`);
    assert.match(result.stdout, /^removed .*\.data\n$/);
    assert.equal(existsSync(data), false);
    assert.equal(readFileSync(join(app, "README.md"), "utf8"), "must survive");
    assert.equal(existsSync(join(app, "scripts", "reset.mjs")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reset refuses while a supervisor is live, and leaves the data intact", async () => {
  const { root, data, reset } = sandbox();
  try {
    writeFileSync(join(data, "supervisor.json"), JSON.stringify({ pid: process.pid, port: 1, token: "t" }));
    const result = await runReset(reset);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /the reference app is running \(pid \d+\)/);
    assert.equal(readFileSync(join(data, "ironflow.db"), "utf8"), "engine history");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reset refuses while the live gate's nested supervisor is running", async () => {
  const { root, data, reset } = sandbox();
  try {
    // What `make test-reference-app-live` leaves in place: a second supervisor
    // under .data/live-test/ that the canonical path never sees.
    mkdirSync(join(data, "live-test"), { recursive: true });
    writeFileSync(
      join(data, "live-test", "supervisor.json"),
      JSON.stringify({ pid: process.pid, port: 1, token: "t" }),
    );
    const result = await runReset(reset);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /the reference app is running/);
    assert.equal(existsSync(data), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a corrupt supervisor file refuses with a fix, not a parse error", async () => {
  const { root, data, reset } = sandbox();
  try {
    writeFileSync(join(data, "supervisor.json"), '{"pid":'); // killed mid-write
    const result = await runReset(reset);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /cannot read .*supervisor\.json — if the reference app is stopped, delete that file/);
    assert.doesNotMatch(result.stderr, /SyntaxError/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a supervisor file from a crashed run does not block a reset", async () => {
  const { root, data, reset } = sandbox();
  try {
    writeFileSync(join(data, "supervisor.json"), JSON.stringify({ pid: DEAD_PID, port: 1, token: "t" }));
    const result = await runReset(reset);
    assert.equal(result.code, undefined, `reset failed: ${result.stderr ?? ""}`);
    assert.equal(existsSync(data), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reset on a directory that was never created says so", async () => {
  const { root, data, reset } = sandbox();
  try {
    rmSync(data, { recursive: true, force: true });
    const result = await runReset(reset);
    assert.equal(result.code, undefined);
    assert.equal(result.stdout, "nothing to reset\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
