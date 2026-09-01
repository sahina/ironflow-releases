// The presenter control plane: paths, the supervisor handshake file, the
// loopback control server, and its client.
//
// The crash scenario needs a way to kill one service from a second terminal
// while `make reference-app` owns the first. The supervisor therefore listens on
// a loopback HTTP port and writes the port plus a random token to
// `.data/supervisor.json` at mode 0600. Anything that can read that file already
// runs as the developer; the token exists so another *process* on the machine
// cannot drive the control plane by guessing a port. The browser never sees it.
import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** `examples/reference-app`, resolved from this file — never from argv or env. */
export const APP_DIR = resolve(fileURLToPath(import.meta.url), "../../..");
export const DATA_DIR = join(APP_DIR, ".data");
export const SUPERVISOR_FILE = join(DATA_DIR, "supervisor.json");

export function isPidLive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0); // signal 0 only checks that the PID exists
    return true;
  } catch (error) {
    return error.code === "EPERM"; // alive, owned by someone else
  }
}

export function writeSupervisorFile({ port, token, file = SUPERVISOR_FILE }) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  // `mode` only applies when writeFileSync creates the file. A leftover file
  // from a SIGKILLed run keeps whatever mode it already had, so a 0644 one
  // would publish the control token. Remove it first and create fresh.
  rmSync(file, { force: true });
  writeFileSync(file, JSON.stringify({ pid: process.pid, port, token }), { mode: 0o600 });
}

export function removeSupervisorFile(file = SUPERVISOR_FILE) {
  rmSync(file, { force: true });
}

export function readSupervisorFile(file = SUPERVISOR_FILE) {
  if (!existsSync(file)) {
    throw new Error(`no supervisor found at ${file} — is \`make reference-app\` running?`);
  }
  const meta = JSON.parse(readFileSync(file, "utf8"));
  if (!isPidLive(meta.pid)) {
    throw new Error(
      `stale supervisor metadata at ${file} (pid ${meta.pid} is gone) — start \`make reference-app\` again`,
    );
  }
  return meta;
}

function tokenMatches(presented, expected) {
  const a = Buffer.from(String(presented ?? ""));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Start the loopback control server.
 *
 * @param actions map of action name to `(target) => Promise<string>`
 * @returns {Promise<{port: number, token: string, close: () => Promise<void>}>}
 */
export function startControlServer({ actions }) {
  const token = randomBytes(24).toString("hex");
  const server = createServer((req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method !== "POST" || req.url !== "/control") return reply(404, { error: "not found" });

    const presented = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    if (!tokenMatches(presented, token)) return reply(401, { error: "bad control token" });

    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 64 * 1024) req.destroy(); // a control command is tiny
    });
    req.on("end", async () => {
      let request;
      try {
        request = JSON.parse(body);
      } catch {
        return reply(400, { error: "body is not JSON" });
      }
      if (request === null || typeof request !== "object") {
        return reply(400, { error: "body must be a JSON object" });
      }
      // Object.hasOwn, not a truthiness check: `actions["constructor"]` and
      // every other Object.prototype member would otherwise pass and be called.
      if (!Object.hasOwn(actions, request.action)) {
        return reply(400, { error: `unknown action: ${request.action}` });
      }
      const action = actions[request.action];
      try {
        reply(200, { message: await action(request.target) });
      } catch (error) {
        // 409: the request was well formed but the system cannot do it now
        // (the targeted service is not running yet, for instance).
        reply(409, { error: error.message });
      }
    });
  });

  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolvePromise({
        port: server.address().port,
        token,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

/** Send one authenticated control request. Throws with the server's message. */
export async function sendControl(action, target, { file = SUPERVISOR_FILE } = {}) {
  const meta = readSupervisorFile(file);
  // Coerce: an unvalidated string here ("80@evil.example") parses as userinfo
  // and would send the bearer token to another host.
  const port = Number(meta.port);
  // port 0 is the placeholder the supervisor writes to claim its data directory
  // before the control plane is up.
  if (port === 0) throw new Error("the reference app is still starting up — try again in a moment");
  if (!Number.isInteger(port) || port <= 0) throw new Error(`bad control port in ${file}: ${meta.port}`);
  const response = await fetch(`http://127.0.0.1:${port}/control`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${meta.token}` },
    body: JSON.stringify({ action, target }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `control request failed (HTTP ${response.status})`);
  return payload.message;
}

/**
 * Refuse to delete anything but this example's own data directory.
 *
 * This is the only code in the launcher that destroys data, so it takes no path
 * from argv or the environment and re-derives every assumption: the path is
 * built from this file's location, it must be named `.data` directly under
 * `examples/reference-app`, it must be a real directory rather than a symlink,
 * and no supervisor may be running against it.
 */
function readPid(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8")).pid;
  } catch {
    return "unreadable"; // fail closed: an unreadable file proves nothing
  }
}

// Every handshake file the reset would destroy, not just the canonical one:
// the live gate runs a second supervisor under `.data/live-test/` via
// REFERENCE_APP_DATA_DIR, and deleting its engine's database mid-run is
// exactly what this guard exists to prevent.
function liveSupervisorFiles(dir, canonical) {
  const found = existsSync(canonical) ? [canonical] : [];
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const nested = join(dir, entry.name, "supervisor.json");
    if (existsSync(nested) && !found.includes(nested)) found.push(nested);
  }
  return found;
}

const isReferenceAppData = (p) =>
  basename(p) === ".data" &&
  basename(dirname(p)) === "reference-app" &&
  basename(dirname(dirname(p))) === "examples";

export function assertResettable(dir = DATA_DIR, { supervisorFile = SUPERVISOR_FILE } = {}) {
  if (!isReferenceAppData(dir)) {
    throw new Error(`refusing to reset ${dir}: not examples/reference-app/.data`);
  }
  if (!existsSync(dir)) return { exists: false, dir };

  // lstat, not stat: a symlink here would move the delete somewhere else.
  if (lstatSync(dir).isSymbolicLink()) throw new Error(`refusing to reset ${dir}: it is a symlink`);
  if (!lstatSync(dir).isDirectory()) throw new Error(`refusing to reset ${dir}: not a directory`);

  // realpath after the symlink check, so the resolved path is compared too —
  // a symlinked parent would otherwise pass the name checks above.
  const real = realpathSync(dir);
  if (!isReferenceAppData(real)) {
    throw new Error(`refusing to reset ${dir}: it resolves to ${real}`);
  }

  for (const file of liveSupervisorFiles(dir, supervisorFile)) {
    const pid = readPid(file);
    if (pid === "unreadable") {
      throw new Error(`cannot read ${file} — if the reference app is stopped, delete that file and retry`);
    }
    if (isPidLive(pid)) {
      throw new Error(`the reference app is running (pid ${pid}) — stop it before resetting`);
    }
  }
  return { exists: true, dir: real };
}
