// The Python notification service's liveness signal, as this UI reads it.
//
// It is a client-only ConnectRPC subscriber: the Python SDK ships no worker
// runtime, so that process registers no function and appears nowhere in
// `GET /api/v1/workers`. The last `notification.sent` is no substitute either —
// a system that has processed no orders would read as a dead subscriber. So it
// writes a timestamp into a KV bucket every few seconds, and this reads it.
//
// A deliberate third copy of these constants, for the same reason
// `lib/workers.ts` keeps its own: this module is bundled for the browser and
// cannot import from `scripts/lib/heartbeat.mjs`, which holds the supervisor's.
// The supervisor's readiness probe is what catches a rename, by failing
// `make reference-app` at startup rather than losing this indicator quietly.

import { FRESH_HEARTBEAT_MS } from "@/lib/workers";

export { FRESH_HEARTBEAT_MS };

/** Must match HEARTBEAT_BUCKET in the Python service's `main.py`. */
export const HEARTBEAT_BUCKET = "reference-app";

/** Must match HEARTBEAT_KEY in the same file. */
export const NOTIFICATIONS_HEARTBEAT_KEY = "notifications-heartbeat";

export type Heartbeat = { service?: string; at?: string };

/**
 * Reads a KV entry into a heartbeat, or `undefined` when it is not one.
 *
 * Both shapes arrive here: the REST entry carries `value` as base64, because Go
 * marshals `[]byte` that way, while the browser SDK hands back the decoded
 * object.
 */
export function parseHeartbeat(entry: unknown): Heartbeat | undefined {
  if (entry === null || typeof entry !== "object") return undefined;
  const { value } = entry as { value?: unknown };
  if (value !== null && typeof value === "object") return value as Heartbeat;
  if (typeof value !== "string") return undefined;
  try {
    const decoded: unknown = JSON.parse(atob(value));
    return decoded !== null && typeof decoded === "object" ? (decoded as Heartbeat) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether a heartbeat is recent enough to be evidence the service is running.
 *
 * A timestamp in the future is clock skew between the engine's host and this
 * browser, not a dead service.
 */
export function heartbeatIsFresh(beat: Heartbeat | undefined, now: number = Date.now()): boolean {
  const at = Date.parse(beat?.at ?? "");
  return Number.isFinite(at) && now - at <= FRESH_HEARTBEAT_MS;
}
