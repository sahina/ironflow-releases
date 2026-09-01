#!/usr/bin/env node
// The reference-app supervisor. One command starts the whole local system.
//
//   engine  ->  ready  ->  services  ->  web
//
// Nothing here picks a port. The engine binds :0 and reports the port it got;
// every child is told that URL through the environment. The presenter never
// edits configuration, and two checkouts can run side by side.
//
// Run it with `make reference-app`. It stays in the foreground until you stop
// it, and it leaves `.data/` intact so history survives a restart.
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import { Supervisor } from "./lib/processes.mjs";
import { waitForHttpOk, waitForJsonFile } from "./lib/readiness.mjs";
import {
  APP_DIR,
  DATA_DIR as DEFAULT_DATA_DIR,
  isPidLive,
  removeSupervisorFile,
  startControlServer,
  writeSupervisorFile,
} from "./lib/control.mjs";

const REPO_ROOT = resolve(APP_DIR, "../..");

// Both overrides exist so the supervisor can be exercised against a fake engine
// in a scratch directory. `make reference-app` sets neither. Note that
// scripts/reset.mjs deliberately ignores them and always derives its own path:
// the one command that deletes must not take its target from the environment.
const BINARY = process.env.REFERENCE_APP_IRONFLOW_BIN || join(REPO_ROOT, "build", "ironflow");
const DATA_DIR = process.env.REFERENCE_APP_DATA_DIR || DEFAULT_DATA_DIR;

const PORT_FILE = join(DATA_DIR, "port.json");
const BOOTSTRAP_KEY_FILE = join(DATA_DIR, "bootstrap-key.json");
const SUPERVISOR_FILE = join(DATA_DIR, "supervisor.json");

// 60s, not 20s: the engine writes the port file at bind time, which is after
// store init, NATS, JetStream stream creation and the projection coordinator.
// A cold first boot on a loaded CI runner needs the room, and the live gate
// has its own 180s budget above this.
const PORT_FILE_TIMEOUT_MS = 60_000;
const READY_TIMEOUT_MS = 60_000;

const log = (message) => process.stderr.write(`[dev]        ${message}\n`);

// The engine gets a scrubbed environment, not the developer's. An ambient
// IRONFLOW_DATABASE_URL or NATS_URL in their shell would otherwise silently
// point this demo at their real database or cluster.
function engineEnv() {
  const out = {};
  for (const name of ["PATH", "HOME", "TMPDIR", "USER", "LANG", "TERM"]) {
    if (process.env[name]) out[name] = process.env[name];
  }
  return out;
}

function engineRow() {
  if (!existsSync(BINARY)) {
    throw new Error(`no engine binary at ${BINARY} — run \`make embed build\` (a plain \`make build\` cannot serve)`);
  }
  return {
    name: "engine",
    cmd: [
      BINARY,
      "serve",
      // Loopback only: this engine runs with a bootstrap admin key and must not
      // be reachable from the LAN.
      "--host", "127.0.0.1",
      "--port", "0",
      "--port-file", PORT_FILE,
      // -1, not 0: the flag's ephemeral value for the embedded NATS socket.
      "--nats-port", "-1",
      "--db", join(DATA_DIR, "ironflow.db"),
      "--nats-store-dir", join(DATA_DIR, "nats"),
      "--bootstrap-key-file", BOOTSTRAP_KEY_FILE,
    ],
    cwd: APP_DIR,
    env: engineEnv(),
    ready: async () => {
      const { http_port: port } = await waitForJsonFile(PORT_FILE, { timeoutMs: PORT_FILE_TIMEOUT_MS });
      // /ready, not /health: readiness covers NATS as well as the database, and
      // every child connects to NATS.
      await waitForHttpOk(`http://127.0.0.1:${port}/ready`, { timeoutMs: READY_TIMEOUT_MS });
      // main() re-reads the port file; start() returns the child, not this value.
      return true;
    },
  };
}

// The bootstrap key is written on first boot only and then persists in .data/.
// Auth stays on: `--dev` would leave an unauthenticated admin API on a loopback
// port that any local process could drive.
function readBootstrapKey() {
  if (!existsSync(BOOTSTRAP_KEY_FILE)) {
    throw new Error(
      `no bootstrap key at ${BOOTSTRAP_KEY_FILE} — the engine writes it on first boot; run \`make reference-app-reset\` and try again`,
    );
  }
  return JSON.parse(readFileSync(BOOTSTRAP_KEY_FILE, "utf8")).key;
}

/**
 * The environment every service child receives. Ambient values come first so a
 * developer's own settings survive; ours override so a stray IRONFLOW_URL in
 * their shell cannot point a child at a different engine.
 *
 * Exported for the supervisor tests and for later slices that add child rows.
 */
export function buildChildEnv({ url, apiKey, dataDir = DATA_DIR, env = process.env }) {
  const ambient = { ...env };
  // Scrub the same hijackers the engine is protected from. A developer with
  // IRONFLOW_DATABASE_URL=postgres://prod exported would otherwise have the Go
  // and Python services read it straight out of their own SDK config.
  for (const name of ["IRONFLOW_DATABASE_URL", "NATS_URL", "NATS_CREDS_FILE"]) delete ambient[name];
  return {
    ...ambient,
    // Both names: the Go and JS SDKs read IRONFLOW_URL first and fall back to
    // IRONFLOW_SERVER_URL, and the worker path reads the latter.
    IRONFLOW_URL: url,
    IRONFLOW_SERVER_URL: url,
    IRONFLOW_API_KEY: apiKey,
    IRONFLOW_ENV: "default",
    // Every service keeps its own SQLite file under this one directory, which is
    // the only path `make reference-app-reset` will delete. A service names its
    // own file inside it.
    REFERENCE_APP_DATA_DIR: dataDir,
    // The engine URL is not a secret; the API key never reaches browser code.
    NEXT_PUBLIC_IRONFLOW_URL: url,
  };
}

/**
 * Service rows, in start order. Empty today: the Go ordering, Node payment,
 * Python notification and web children arrive in later slices of #1894, one row
 * each. See the child-table shape in lib/processes.mjs.
 */
export function serviceRows(_context) {
  return [];
}

// Two supervisors sharing one .data directory corrupt each other: the second
// deletes the first's port file and handshake file, so the first's crash
// control goes dead and its recorded port points at an engine that is gone.
// Refuse before touching any shared file. (Starting it twice by accident is
// the most likely way a presenter hits this.)
function assertSoleOwner() {
  if (!existsSync(SUPERVISOR_FILE)) return;
  let pid;
  try {
    pid = JSON.parse(readFileSync(SUPERVISOR_FILE, "utf8")).pid;
  } catch {
    return; // unreadable leftovers are this run's to replace
  }
  if (isPidLive(pid)) {
    throw new Error(
      `another reference app is already running (pid ${pid}) using ${DATA_DIR} — stop it first, or run this checkout's copy`,
    );
  }
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  // Outside the try below on purpose: that block's cleanup deletes shared files,
  // which is only safe once this check has proved nobody else owns them.
  try {
    assertSoleOwner();
  } catch (error) {
    process.stderr.write(`[dev]        ${error.message}\n`);
    process.exit(1);
  }
  // A port file left by a previous run would otherwise be read as this run's
  // port, and every child would target a dead server. Safe only because
  // assertSoleOwner just proved no other supervisor owns this directory.
  rmSync(PORT_FILE, { force: true });
  // Claim the directory NOW, not after the engine is ready: booting can take a
  // minute, and until this file exists `make reference-app-reset` would happily
  // delete the database the engine is in the middle of creating. Port and token
  // are filled in once the control plane is up.
  writeSupervisorFile({ port: 0, token: "", file: SUPERVISOR_FILE });

  const supervisor = new Supervisor({ log });
  let shuttingDown = false;
  let control;

  const cleanup = async () => {
    await supervisor.stopAll();
    if (control) await control.close();
    removeSupervisorFile(SUPERVISOR_FILE);
  };

  const shutdown = async (signal, code = 0) => {
    if (shuttingDown) {
      // A second Ctrl-C means the first one is not getting anywhere. Give the
      // presenter an exit instead of a dead terminal.
      log("second signal — exiting now");
      process.exit(code || 1);
    }
    shuttingDown = true;
    log(`${signal} — stopping`);
    try {
      await cleanup();
    } catch (error) {
      // An unhandled rejection here would kill the supervisor and orphan the
      // engine — the one thing shutdown exists to prevent.
      process.stderr.write(`[dev]        shutdown failed: ${error.message}\n`);
      process.exit(1);
    }
    process.exit(code);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    const engine = await supervisor.start(engineRow());
    const { http_port: port } = JSON.parse(readFileSync(PORT_FILE, "utf8"));
    const url = `http://127.0.0.1:${port}`;
    const env = buildChildEnv({ url, apiKey: readBootstrapKey() });

    for (const row of serviceRows({ url, env })) {
      await supervisor.start(row);
    }

    control = await startControlServer({
      actions: {
        // Targets any row marked crashable. Until the payment service lands,
        // this answers with a clear "no such service" instead of a stack trace.
        crash: (target) => supervisor.crashAndRestart(target ?? "payments"),
      },
    });
    writeSupervisorFile({ port: control.port, token: control.token, file: SUPERVISOR_FILE });

    log("ready");
    log(`  dashboard  ${url}`);
    log(`  engine     ${url}/api/v1`);
    log("  web        not yet — the web application arrives in a later slice of #1894");
    log("stop with Ctrl-C; data persists in .data/");

    await engine.exited;
    if (!shuttingDown) {
      log("the engine exited — stopping");
      await shutdown("engine exit", 1);
    }
  } catch (error) {
    process.stderr.write(`[dev]        startup failed: ${error.message}\n`);
    await cleanup();
    process.exit(1);
  }
}

// import.meta.main, not an argv[1] comparison: argv[1] is the path as typed
// while import.meta.url is realpath'd, so behind a symlinked checkout (macOS
// /var -> /private/var, a symlinked home) the comparison is false and the
// script exits 0 having done nothing.
if (import.meta.main) {
  await main();
}
