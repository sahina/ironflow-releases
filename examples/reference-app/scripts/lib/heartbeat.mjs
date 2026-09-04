// The Python notification service's liveness signal, shared by the supervisor,
// the live scripts and (in its own copy) the web application.
//
// Why KV and not a worker record: the Python SDK ships no worker runtime, so
// that service claims no worker slot and appears nowhere in
// `GET /api/v1/workers`. And the last `notification.sent` is no substitute — a
// system that has processed no orders would read as a dead subscriber.
//
// `apps/web/src/lib/heartbeat.ts` keeps its own copy of these two constants and
// the freshness window: it is bundled for the browser and cannot import from
// `scripts/`. The supervisor's readiness probe is what catches a rename, by
// failing `make reference-app` at startup.

import { FRESH_HEARTBEAT_MS } from "./workers.mjs";

/** Must match HEARTBEAT_BUCKET in services/notifications-python/src/reference_notifications/main.py. */
export const HEARTBEAT_BUCKET = "reference-app";

/** Must match HEARTBEAT_KEY in the same file. */
export const NOTIFICATIONS_HEARTBEAT_KEY = "notifications-heartbeat";

/**
 * Reads a KV entry into a heartbeat, or `undefined` when it is not one.
 *
 * The REST entry carries `value` as base64 — Go marshals `[]byte` that way — and
 * the browser SDK hands back the decoded object. Both shapes arrive here so
 * that one rule about freshness serves every caller.
 */
export function parseHeartbeat(entry) {
  if (!entry || typeof entry !== "object") return undefined;
  const { value } = entry;
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64").toString("utf8"));
    return decoded && typeof decoded === "object" ? decoded : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether a heartbeat is recent enough to be evidence the service is running.
 *
 * The same window the payment worker is judged by, for the same reason: a
 * presenter watching `/system` should see both services appear and disappear at
 * the same speed. A timestamp in the future is clock skew between the engine's
 * host and this process, not a dead service.
 */
export function heartbeatIsFresh(beat, now = Date.now()) {
  const at = Date.parse(beat?.at ?? "");
  return Number.isFinite(at) && now - at <= FRESH_HEARTBEAT_MS;
}
