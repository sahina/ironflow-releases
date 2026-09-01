// Child process control for the reference-app supervisor.
//
// This is the only module that touches OS process control, so the supervisor's
// ordering, readiness and crash logic stays testable with fake children.
//
// Two spawn shapes, same reason as the desktop supervisor:
//  - default: the process forks nothing, so SIGTERM on the PID reaps it. The
//    engine is this shape — `ironflow serve` runs embedded NATS in-process.
//  - group: the command forks (`pnpm dev` -> node -> the toolchain), so a
//    PID-only kill orphans the tree and leaves dev servers holding ports. Those
//    children are spawned as their own process-group leader and killed by group.
import { spawn } from "node:child_process";

const PALETTE = ["36", "35", "33", "32", "34"]; // cyan magenta yellow green blue
const ESC = "\u001b";

function colorize(text, code, enabled) {
  return enabled ? `${ESC}[${code}m${text}${ESC}[0m` : text;
}

export function makePrefix(name, index, { color = !process.env.NO_COLOR && process.stdout.isTTY } = {}) {
  return colorize(`[${name}]`.padEnd(12), PALETTE[index % PALETTE.length], color);
}

// Splits a byte stream into whole lines before prefixing. Without this a child
// that flushes mid-line puts the prefix in the middle of its own output.
function lineWriter(prefix, sink) {
  let buffered = "";
  const write = (chunk) => {
    buffered += chunk;
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) sink(`${prefix} ${line}\n`);
  };
  // A child that dies mid-sentence writes no trailing newline. Without this
  // flush its last line — usually the one saying why it died — is swallowed.
  write.flush = () => {
    if (buffered === "") return;
    sink(`${prefix} ${buffered}\n`);
    buffered = "";
  };
  return write;
}

// Poll until no process remains in the group, escalating once the grace window
// is spent. Bounded: after graceMs + a hard ceiling we stop waiting, because a
// process we cannot kill is not something a demo launcher can fix.
async function waitForGroupExit(pid, graceMs, ceilingMs = 10_000) {
  const deadline = Date.now() + graceMs + ceilingMs;
  for (;;) {
    try {
      process.kill(-pid, 0);
    } catch {
      return; // ESRCH: the group is empty
    }
    if (Date.now() > deadline) return;
    signalPid(pid, "SIGKILL", true);
    await new Promise((r) => setTimeout(r, 25));
  }
}

function signalPid(pid, signal, group) {
  try {
    process.kill(group ? -pid : pid, signal);
  } catch {
    // ESRCH: already gone. Nothing to signal.
  }
}

/**
 * Spawn one labeled child.
 *
 * @returns {{name: string, pid: number, exited: Promise<{code: number|null, signal: string|null}>, kill: (opts?: {signal?: string, graceMs?: number}) => Promise<object>}}
 */
export function spawnChild({
  name,
  cmd,
  cwd,
  env,
  group = false,
  prefix = `[${name}]`,
  stdout = process.stdout,
  stderr = process.stderr,
}) {
  const cp = spawn(cmd[0], cmd.slice(1), {
    cwd,
    env,
    detached: group,
    stdio: ["ignore", "pipe", "pipe"],
  });
  cp.stdout.setEncoding("utf8");
  cp.stderr.setEncoding("utf8");
  for (const [pipe, sink] of [
    [cp.stdout, stdout],
    [cp.stderr, stderr],
  ]) {
    const writer = lineWriter(prefix, (line) => sink.write(line));
    pipe.on("data", writer);
    pipe.on("end", () => writer.flush());
  }

  let settled = false;
  const exited = new Promise((resolve) => {
    const settle = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    cp.on("exit", (code, signal) => settle({ code, signal }));
    // Spawn failure (bad binary, missing cwd) never emits "exit". Resolve so no
    // caller hangs waiting for a process that never started.
    cp.on("error", (error) => settle({ code: 127, signal: null, error }));
  });

  return {
    name,
    get pid() {
      return cp.pid ?? -1;
    },
    exited,
    async kill({ signal = "SIGTERM", graceMs = 5000 } = {}) {
      if (settled) return exited;
      const pid = cp.pid;
      if (pid === undefined) return exited;
      signalPid(pid, signal, group);
      // Always await the real exit: callers delete files and release ports
      // afterwards and must not race a process that is still dying.
      let escalation;
      if (graceMs > 0 && signal !== "SIGKILL") {
        escalation = setTimeout(() => signalPid(pid, "SIGKILL", group), graceMs);
        escalation.unref();
      }
      try {
        const result = await exited;
        // For a group, the leader exiting proves nothing: `sh -c "pnpm dev"`
        // forwards SIGTERM and dies at once while the dev server it forked
        // traps the signal and keeps its port. Wait for the whole group.
        if (group) await waitForGroupExit(pid, graceMs);
        return result;
      } finally {
        if (escalation) clearTimeout(escalation);
      }
    },
  };
}

/**
 * The child table. Each row is:
 *
 *   {
 *     name: "payments",          // stable label, also the crash-control target
 *     cmd: ["pnpm", "..."],      // argv
 *     cwd, env,                  // spawn context
 *     group: true,               // forks children — kill the group, not the PID
 *     crashable: true,           // the crash control may target it
 *     ready: async (child) => {} // resolves when the child is usable
 *   }
 *
 * Rows start in order and stop in reverse. Later slices of #1894 add one row per
 * service; nothing else in this class changes.
 */
export class Supervisor {
  #entries = new Map();
  #stopping = false;
  #lifecycle = Promise.resolve(); // serializes crash/restart against itself

  constructor({ spawnFn = spawnChild, log = (m) => process.stderr.write(`${m}\n`) } = {}) {
    this.spawnFn = spawnFn;
    this.log = log;
  }

  get names() {
    return [...this.#entries.keys()];
  }

  child(name) {
    return this.#entries.get(name)?.child;
  }

  /**
   * Spawn a row and wait for its readiness probe. A child that exits before it
   * is ready fails startup immediately instead of leaving the supervisor waiting
   * out the probe timeout on a process that is already gone.
   */
  async start(row, { replace = false } = {}) {
    const existing = this.#entries.get(row.name);
    const prefix = row.prefix ?? existing?.prefix ?? makePrefix(row.name, this.#entries.size);
    const child = this.spawnFn({ ...row, prefix });
    if (replace && existing) {
      existing.child = child; // keeps this row's position in the table
    } else {
      this.#entries.set(row.name, { row, child, prefix });
    }

    child.exited.then(({ code, signal }) => {
      if (!this.#stopping) this.log(`${prefix} exited (${signal ?? `code ${code}`})`);
    });

    if (row.ready) {
      const died = child.exited.then(({ code, signal }) => {
        throw new Error(`${row.name} exited before it was ready (${signal ?? `code ${code}`})`);
      });
      try {
        await Promise.race([row.ready(child), died]);
      } finally {
        died.catch(() => {}); // the loser rejects later; do not surface it twice
      }
    }
    return child;
  }

  /** Stop every child in reverse start order. Leaves persistent data intact. */
  async stopAll() {
    this.#stopping = true;
    await this.#lifecycle.catch(() => {}); // let an in-flight restart finish
    for (const { child } of [...this.#entries.values()].reverse()) {
      await child.kill();
    }
    this.#entries.clear();
    this.#stopping = false;
  }

  /**
   * The presenter crash control: SIGKILL one crashable child, report the exit,
   * then start it again from the same row. Durable replay — not this
   * supervisor — is what makes the restart finish the interrupted work.
   */
  async crashAndRestart(name) {
    if (this.#stopping) throw new Error("the reference app is shutting down");
    // Serialize: the control server handles requests concurrently, so two
    // crash commands in quick succession would each spawn a replacement and
    // leave all but the last untracked — orphaned when the supervisor exits.
    this.#lifecycle = this.#lifecycle.then(
      () => this.#crashAndRestart(name),
      () => this.#crashAndRestart(name),
    );
    return this.#lifecycle;
  }

  async #crashAndRestart(name) {
    if (this.#stopping) throw new Error("the reference app is shutting down");
    const entry = this.#entries.get(name);
    if (!entry) throw new Error(`no such service: ${name}`);
    if (!entry.row.crashable) throw new Error(`${name} is not a crashable service`);

    const { code, signal } = await entry.child.kill({ signal: "SIGKILL", graceMs: 0 });
    // Replace the child in place. Deleting and re-adding would move the row to
    // the end of the Map, so stopAll would stop it out of order and makePrefix
    // would hand it a different color mid-demo.
    await this.start(entry.row, { replace: true });
    return `${name} crashed (${signal ?? `code ${code}`}) and restarted`;
  }
}
