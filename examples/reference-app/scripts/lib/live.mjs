// The harness both live gates share: boot the real supervisor, drive the real
// engine, take the whole process group down again.
//
// Two scripts need it — scripts/test-live.mjs proves the boot contract and the
// ordering path, scripts/test-crash-resume.mjs proves durable replay across a
// killed worker — and neither is allowed to invent a second way to start the
// system. Both go through scripts/dev.mjs, the same launcher a presenter runs.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { APP_DIR } from "./control.mjs";

const DEV = fileURLToPath(new URL("../dev.mjs", import.meta.url));

/** One safe Ironflow subject segment — the shape common.v1 calls an entityId. */
export const newId = () => randomUUID().replaceAll("-", "");

/**
 * How long a signalled supervisor gets to shut down cleanly before it is killed.
 *
 * dev.mjs drains its children and removes the handshake file in about two
 * seconds. Long enough for that, short enough that Ctrl-C does not feel hung.
 */
const SIGNAL_GRACE_MS = 5_000;

// The engine prints the throwaway dashboard admin password on first boot, and
// these gates start from a fresh directory every run. Keep it out of CI logs —
// along with the bootstrap key, which nothing prints today but which every one
// of these gates has in its environment.
export const redact = (text) =>
  text.replace(/Password:.*/g, "Password: [redacted]").replace(/ifkey_[A-Za-z0-9_-]+/g, "ifkey_[redacted]");

/**
 * Asserts a negative holds for a whole window, not at one instant.
 *
 * A fixed sleep before "this never happened" is the weakest shape a test can
 * take: it passes when the engine is merely slower than the sleep. This samples
 * repeatedly and fails the moment the negative stops being true.
 */
export async function staysTrue(what, probe, { windowMs = 4_000, intervalMs = 250 } = {}) {
  const deadline = Date.now() + windowMs;
  for (;;) {
    if (!(await probe())) throw new Error(`${what} stopped being true`);
    if (Date.now() > deadline) return;
    await sleep(intervalMs);
  }
}

/** A named step whose failure names itself. */
export function checker(write = (line) => process.stdout.write(line)) {
  return async (what, fn) => {
    try {
      await fn();
    } catch (error) {
      error.message = `${what}: ${error.message}`;
      throw error;
    }
    write(`  ok  ${what}\n`);
  };
}

/**
 * Start `scripts/dev.mjs` against `dataDir` and wait for it to report ready.
 *
 * The supervisor runs in its own process group: on the failure path, killing its
 * PID alone would leave the engine running, holding the data directory and a
 * port for the rest of the CI job.
 *
 * `env` overrides the child environment. The load gate sets
 * REFERENCE_APP_SKIP_WEB there: `next dev` logs every request and the UI polls
 * the whole read model every 2s, which is load that gate did not ask for and
 * would end up measuring.
 */
export async function startSupervisor({ dataDir, readyTimeoutMs = 180_000, env = {} }) {
  let output = "";
  const dev = spawn(process.execPath, [DEV], {
    cwd: APP_DIR,
    env: { ...process.env, REFERENCE_APP_DATA_DIR: dataDir, NO_COLOR: "1", ...env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  dev.stdout.on("data", (c) => (output += c));
  dev.stderr.on("data", (c) => (output += c));
  // "close", not "exit": exit can fire before the last stdout chunk arrives, and
  // the ready loop below would then report a ready supervisor as having died.
  const exited = new Promise((resolve) => dev.on("close", (code) => resolve(code)));

  const supervisor = {
    dev,
    exited,
    text: () => output,
    /**
     * The end of the log, which is where a failure is.
     *
     * `next dev` logs every request, the UI polls every 2s and the run probes
     * poll faster — four minutes of that buries the one line worth reading, and
     * a CI job that has to scroll past a megabyte to find it will not be read.
     */
    tail: (bytes = 64 * 1024) => (output.length <= bytes ? output : `… earlier output trimmed …\n${output.slice(-bytes)}`),
    /** Ask for a clean stop, then take the group if it will not go. */
    async stop({ graceMs = 10_000 } = {}) {
      try {
        process.kill(-dev.pid, "SIGINT");
        return await Promise.race([exited, sleep(graceMs).then(() => undefined)]);
      } catch {
        return undefined;
      } finally {
        try {
          process.kill(-dev.pid, "SIGKILL");
        } catch {
          // already gone
        }
      }
    },
  };

  // Ctrl-C, and CI cancelling the job, both land here.
  //
  // The supervisor is deliberately detached (above), so it does NOT receive the
  // signal the terminal sends this process — and the only teardown these gates
  // had was in their catch blocks, which a signal never reaches. Interrupting
  // any of the three live scripts therefore left an engine, four services and
  // an open port running for the rest of the session.
  //
  // SIGINT first, SIGKILL only if it will not go. dev.mjs has its own shutdown
  // (`process.on("SIGINT", ...)`) that drains the four children and calls
  // removeSupervisorFile; going straight to SIGKILL skips all of it, so the
  // engine dies mid-write to SQLite and NATS and a supervisor.json survives
  // naming a pid that is gone — which then makes `make reference-app-reset`
  // refuse to run. This is the same SIGINT-then-SIGKILL shape stop() uses.
  //
  // The handler is registered with `once`, so a second Ctrl-C during the grace
  // hits Node's default action and exits immediately: an impatient human is not
  // made to wait twice.
  const onSignal = (signal) => {
    try {
      process.kill(-dev.pid, "SIGINT");
    } catch {
      // already gone
    }
    Promise.race([exited, sleep(SIGNAL_GRACE_MS)]).then(() => {
      try {
        process.kill(-dev.pid, "SIGKILL");
      } catch {
        // already gone
      }
      // The `once` above already removed this handler, so re-raising takes the
      // default action and the exit status still says which signal arrived.
      process.kill(process.pid, signal);
    });
  };
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, onSignal);
  exited.then(() => {
    for (const signal of ["SIGINT", "SIGTERM"]) process.removeListener(signal, onSignal);
  });

  const deadline = Date.now() + readyTimeoutMs;
  let running = true;
  exited.then(() => (running = false));
  while (!/\[dev]\s+ready\n/.test(output)) {
    if (!running) throw new Error(`the supervisor exited before it was ready:\n${redact(output)}`);
    if (Date.now() > deadline) {
      await supervisor.stop();
      throw new Error(`the supervisor was not ready within ${readyTimeoutMs}ms:\n${redact(output)}`);
    }
    await sleep(200);
  }

  // Wrapped, because a throw here escapes before the caller has a handle. The
  // caller's cleanup is `if (supervisor) await supervisor.stop()`, and
  // `supervisor` is still undefined until this function returns — so an
  // unreadable port file would leave the detached engine running for the rest
  // of the CI job, holding the data directory and its port.
  try {
    const { http_port: port } = JSON.parse(readFileSync(join(dataDir, "port.json"), "utf8"));
    supervisor.port = port;
    supervisor.url = `http://127.0.0.1:${port}`;
    // The web port is chosen by the supervisor and announced once. A presenter
    // reads it off the same line.
    supervisor.webUrl = output.match(/web\s+(http:\/\/127\.0\.0\.1:\d+)\/shop/)?.[1];
    supervisor.apiKey = JSON.parse(readFileSync(join(dataDir, "bootstrap-key.json"), "utf8")).key;
  } catch (error) {
    await supervisor.stop();
    throw error;
  }
  return supervisor;
}

/**
 * The engine, as these gates drive it: the same public surface the web
 * application uses, with no shortcut into a service's own state.
 */
export function engineApi({ url, apiKey }) {
  const headers = { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };

  // Every request carries its own deadline. waitFor checks its timeout only
  // *between* probes, so a server that accepts the connection and never answers
  // would otherwise hang the gate forever instead of failing it.
  const PROBE_TIMEOUT_MS = 15_000;
  const signal = () => AbortSignal.timeout(PROBE_TIMEOUT_MS);

  const post = async (path, body) => {
    const response = await fetch(`${url}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: signal(),
    });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${await response.text()}`);
    return response.json();
  };

  const projectedOrders = async () => {
    const response = await fetch(`${url}/api/v1/projections/orders`, { headers, signal: signal() });
    if (!response.ok) return {};
    const body = await response.json();
    return body?.state?.state?.orders ?? {};
  };

  return {
    headers,
    post,
    emit: (event, data, metadata) => post("/ironflow.v1.PubSubService/Emit", { event, data, metadata }),
    // A bare topic name, the way the ordering service publishes one. The engine
    // files it under the developer pub/sub namespace; a subscriber names that
    // namespace back (`topic:{name}`).
    publish: (topic, data) => post("/ironflow.v1.PubSubService/Publish", { topic, data }),
    async schemaNames() {
      const response = await fetch(`${url}/api/v1/events/schemas`, { headers, signal: signal() });
      if (!response.ok) throw new Error(`schemas: HTTP ${response.status}`);
      return ((await response.json()).schemas ?? []).map((schema) => schema.event_name ?? schema.eventName);
    },
    /**
     * Every order in the read model, keyed by id.
     *
     * The projection is deliberately unpartitioned — `@ironflow/browser` can
     * read one partition but cannot enumerate them — so this is the same single
     * read the web application makes.
     */
    projectedOrders,
    async projectedOrder(orderId) {
      return (await projectedOrders())[orderId];
    },
    orderStream: (orderId) => post("/ironflow.v1.EntityStreamService/ReadStream", { entity_id: `order-${orderId}` })
      .then((body) => body.events ?? []),
    paymentStream: (orderId) => post("/ironflow.v1.EntityStreamService/ReadStream", { entity_id: `payment-${orderId}` })
      .then((body) => body.events ?? []),
    async runs(query = {}) {
      const search = new URLSearchParams(query).toString();
      const response = await fetch(`${url}/api/v1/runs${search ? `?${search}` : ""}`, { headers, signal: signal() });
      if (!response.ok) throw new Error(`runs: HTTP ${response.status}`);
      return (await response.json()).runs ?? [];
    },
    async runSteps(runId) {
      const response = await fetch(`${url}/api/v1/runs/${runId}/steps`, { headers, signal: signal() });
      if (!response.ok) throw new Error(`run steps: HTTP ${response.status}`);
      return (await response.json()).steps ?? [];
    },
    async workers() {
      const response = await fetch(`${url}/api/v1/workers`, { headers, signal: signal() });
      if (!response.ok) throw new Error(`workers: HTTP ${response.status}`);
      return (await response.json()).workers ?? [];
    },
  };
}

/** The metadata the web application puts on every command. */
export const commandMetadata = (orderId, session) => ({
  correlationId: orderId,
  causationId: `live-${orderId}`,
  producer: "web",
  demoSessionId: session,
});
