// Supervisor process tests. Children are real processes — small `node -e`
// scripts — because the failures worth catching (a child that dies before it is
// ready, a process group that outlives its leader) only happen at the OS level.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { Writable } from "node:stream";

import { Supervisor, makePrefix, spawnChild } from "./processes.mjs";

const nodeScript = (source) => [process.execPath, "-e", source];

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// Poll instead of sleeping a fixed budget: a fixed sleep is the classic
// flake on a loaded CI runner, in both directions.
async function waitUntil(probe, what, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(10);
  }
}
const collect = (lines) => new Writable({ write(chunk, _enc, cb) { lines.push(String(chunk)); cb(); } });
const sink = () => new Writable({ write(_c, _e, cb) { cb(); } });

test("prefixes child output line by line", async () => {
  const lines = [];
  const child = spawnChild({
    name: "demo",
    prefix: "[demo]",
    // Two writes that together form one line, then a second line: the prefix
    // must land once per line, not once per write.
    cmd: nodeScript("process.stdout.write('he'); process.stdout.write('llo\\nworld\\n')"),
    stdout: collect(lines),
    stderr: sink(),
  });
  await child.exited;
  await sleep(20);
  assert.deepEqual(lines.join(""), "[demo] hello\n[demo] world\n");
});

test("makePrefix pads and cycles colors", () => {
  assert.equal(makePrefix("engine", 0, { color: false }), "[engine]    ");
  assert.equal(makePrefix("a", 0, { color: true }), makePrefix("a", 5, { color: true }));
});

test("exited resolves rather than hanging when the binary does not exist", async () => {
  const child = spawnChild({ name: "missing", cmd: ["/nonexistent/binary"], stdout: sink(), stderr: sink() });
  const { code } = await child.exited;
  assert.equal(code, 127);
});

test("start fails fast when a child exits before it is ready", async () => {
  const supervisor = new Supervisor({ log: () => {} });
  await assert.rejects(
    supervisor.start({
      name: "doomed",
      cmd: nodeScript("process.exit(3)"),
      stdout: sink(),
      stderr: sink(),
      // ref: false — a pending 60s timer would otherwise hold the test runner open.
      ready: () => sleep(60_000, undefined, { ref: false }),
    }),
    /doomed exited before it was ready \(code 3\)/,
  );
});

test("start returns once the readiness probe resolves", async () => {
  const supervisor = new Supervisor({ log: () => {} });
  const child = await supervisor.start({
    name: "ok",
    cmd: nodeScript("setTimeout(() => {}, 60000)"),
    stdout: sink(),
    stderr: sink(),
    ready: async () => true,
  });
  assert.ok(child.pid > 0);
  assert.deepEqual(supervisor.names, ["ok"]);
  await supervisor.stopAll();
});

test("stopAll stops children in reverse start order and clears the table", async () => {
  const stopped = [];
  const fakeSpawn = ({ name }) => ({
    name,
    pid: 1,
    exited: Promise.resolve({ code: 0, signal: null }),
    kill: async () => {
      stopped.push(name);
      return { code: 0, signal: null };
    },
  });
  const supervisor = new Supervisor({ spawnFn: fakeSpawn, log: () => {} });
  for (const name of ["engine", "orders", "web"]) await supervisor.start({ name, cmd: ["x"] });
  await supervisor.stopAll();
  assert.deepEqual(stopped, ["web", "orders", "engine"]);
  assert.deepEqual(supervisor.names, []);
});

test("a group child is killed with its whole tree", { timeout: 20_000 }, async () => {
  // `sh -c "<one command>"` EXECS it — same pid, group of one, and a PID-only
  // kill would pass. The trailing `wait` forces sh to stay and fork, which is
  // the shape a real dev command (`pnpm dev` -> node -> toolchain) has.
  const lines = [];
  const child = spawnChild({
    name: "group",
    cmd: ["sh", "-c", `${process.execPath} -e "console.log(process.pid);setInterval(()=>{},1000)" & wait`],
    group: true,
    stdout: collect(lines),
    stderr: sink(),
  });
  const grandchild = Number(
    await waitUntil(() => /(\d+)/.exec(lines.join(""))?.[1], "the grandchild to report its pid"),
  );
  assert.notEqual(grandchild, child.pid, "sh must have forked, or this test proves nothing");

  await child.kill({ graceMs: 500 });
  await waitUntil(() => !isAlive(grandchild), "the grandchild to die with the group");
  assert.equal(isAlive(child.pid), false, "the group leader must be gone too");
});

test("a child that ignores SIGTERM is escalated to SIGKILL", { timeout: 10_000 }, async () => {
  const child = spawnChild({
    name: "stubborn",
    cmd: nodeScript('process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'),
    stdout: sink(),
    stderr: sink(),
  });
  await sleep(200); // let the handler install before we signal
  assert.deepEqual(await child.kill({ graceMs: 100 }), { code: null, signal: "SIGKILL" });
});

test("a child's last line survives even without a trailing newline", async () => {
  const lines = [];
  const child = spawnChild({
    name: "dying",
    // The shape that matters: the reason a child died, written without "\n".
    cmd: nodeScript('process.stdout.write("fatal: no trailing newline")'),
    stdout: collect(lines),
    stderr: sink(),
  });
  await child.exited;
  await waitUntil(() => lines.join("").includes("fatal"), "the partial line to be flushed");
  assert.equal(lines.join(""), "[dying] fatal: no trailing newline\n");
});

test("crashAndRestart keeps the row's position and prefix", async () => {
  const order = [];
  const fakeSpawn = ({ name, prefix }) => ({
    name,
    prefix,
    pid: 1,
    exited: new Promise(() => {}),
    kill: async () => {
      order.push(name);
      return { code: null, signal: "SIGKILL" };
    },
  });
  const supervisor = new Supervisor({ spawnFn: fakeSpawn, log: () => {} });
  await supervisor.start({ name: "engine", cmd: ["x"] });
  await supervisor.start({ name: "payments", cmd: ["x"], crashable: true });
  await supervisor.start({ name: "web", cmd: ["x"] });
  const prefixBefore = supervisor.child("payments").prefix;

  await supervisor.crashAndRestart("payments");
  assert.equal(supervisor.child("payments").prefix, prefixBefore, "the color must not change mid-demo");

  order.length = 0;
  await supervisor.stopAll();
  // web still stops before payments, exactly as it would without the crash.
  assert.deepEqual(order, ["web", "payments", "engine"]);
});

test("crashAndRestart replaces a crashable child with a new process", async () => {
  const supervisor = new Supervisor({ log: () => {} });
  const row = {
    name: "payments",
    cmd: nodeScript("setTimeout(() => {}, 60000)"),
    crashable: true,
    stdout: sink(),
    stderr: sink(),
    ready: async () => true,
  };
  const first = await supervisor.start(row);
  const message = await supervisor.crashAndRestart("payments");
  const second = supervisor.child("payments");
  assert.match(message, /payments crashed \(SIGKILL\) and restarted/);
  assert.notEqual(second.pid, first.pid);
  assert.deepEqual(await first.exited, { code: null, signal: "SIGKILL" });
  await supervisor.stopAll();
});

test("crashAndRestart refuses unknown and non-crashable targets", async () => {
  const supervisor = new Supervisor({ spawnFn: ({ name }) => ({ name, pid: 1, exited: new Promise(() => {}), kill: async () => ({}) }), log: () => {} });
  await supervisor.start({ name: "engine", cmd: ["x"] }); // crashable is unset
  await assert.rejects(supervisor.crashAndRestart("payments"), /no such service: payments/);
  await assert.rejects(supervisor.crashAndRestart("engine"), /engine is not a crashable service/);
});
