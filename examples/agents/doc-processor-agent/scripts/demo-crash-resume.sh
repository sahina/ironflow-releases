#!/usr/bin/env bash
# demo-crash-resume.sh — literal script behind `make demo-agent-crash-resume`.
#
# Starts an Ironflow server (--dev), the doc-processor worker, fires a
# doc.received event, kill -9s the worker mid-OCR, restarts the worker,
# and asserts the run completes by polling the memory projection.
#
# Usage:
#   ./scripts/demo-crash-resume.sh                  # uses bundled binary build/ironflow
#   IRONFLOW_BIN=/path/to/ironflow ./scripts/demo-crash-resume.sh
#
# Exit codes:
#   0  agent recovered from crash, projection saw doc-2 published
#   1  agent did not recover before VERIFY_TIMEOUT_MS
#   2  setup error (server failed to start, build failed, etc.)

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLE_DIR="$(cd "${HERE}/.." && pwd)"
REPO_ROOT="$(cd "${EXAMPLE_DIR}/../../.." && pwd)"
LOG_DIR="$(mktemp -d -t doc-processor-demo-XXXXXX)"
SERVER_LOG="${LOG_DIR}/server.log"
WORKER_LOG="${LOG_DIR}/worker.log"
WORKER2_LOG="${LOG_DIR}/worker-resume.log"
# Isolated SQLite db so the demo doesn't accumulate state across re-runs
# in the user's working directory. Without this, repeat runs against a
# polluted ironflow.db can flake (stale projection consumers, etc).
SERVER_DB="${LOG_DIR}/ironflow.db"

IRONFLOW_BIN="${IRONFLOW_BIN:-${REPO_ROOT}/build/ironflow}"
# Pick an ephemeral port so re-runs don't collide with a stuck previous
# server holding 9123. Caller can override IRONFLOW_PORT/IRONFLOW_URL.
SERVER_PORT="${IRONFLOW_PORT:-$((30000 + RANDOM % 30000))}"
IRONFLOW_URL="${IRONFLOW_URL:-http://localhost:${SERVER_PORT}}"
DOC_ID="${DEMO_DOC_ID:-demo-crash-$(date +%s)}"
IMAGE_URL="${DEMO_IMAGE_URL:-https://example.com/invoice.png}"
OCR_MS="${DOC_PROCESSOR_OCR_MS:-3000}"
KILL_AFTER_MS="${DEMO_KILL_AFTER_MS:-1500}"

export DOC_PROCESSOR_OCR_MS="${OCR_MS}"
# Both env names: SDK client + REST worker read IRONFLOW_SERVER_URL,
# the agent module's memory backend reads IRONFLOW_URL first then falls
# back to IRONFLOW_SERVER_URL. Setting both keeps every code path on
# the random demo port.
export IRONFLOW_URL
export IRONFLOW_SERVER_URL="${IRONFLOW_URL}"

cleanup() {
  set +e
  for pid in "${WORKER_PID:-}" "${WORKER2_PID:-}" "${SERVER_PID:-}"; do
    [[ -z "$pid" ]] && continue
    kill -0 "$pid" 2>/dev/null || continue
    kill -TERM "$pid" 2>/dev/null || true
    # Give NATS + the HTTP server time to release ports so back-to-back
    # local re-runs don't hit TIME_WAIT collisions on 4222.
    for _ in $(seq 1 20); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.1
    done
    kill -KILL "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
  echo
  echo "logs preserved at ${LOG_DIR}"
}
trap cleanup EXIT

log() { printf '\033[1;36m[demo]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[demo]\033[0m %s\n' "$*" >&2; }

# ── 0. preconditions ────────────────────────────────────────────
if [[ ! -x "${IRONFLOW_BIN}" ]]; then
  err "ironflow binary not found at ${IRONFLOW_BIN}"
  err "build it first: (cd ${REPO_ROOT} && make build)"
  exit 2
fi

# ── 1. start server ─────────────────────────────────────────────
log "starting server (port: ${SERVER_PORT}, logs: ${SERVER_LOG}, db: ${SERVER_DB})"
"${IRONFLOW_BIN}" serve --dev --port "${SERVER_PORT}" --db "${SERVER_DB}" >"${SERVER_LOG}" 2>&1 &
SERVER_PID=$!

# wait for server ready
for _ in $(seq 1 60); do
  if curl -fs "${IRONFLOW_URL}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done
if ! curl -fs "${IRONFLOW_URL}/health" >/dev/null 2>&1; then
  err "server failed to come up"
  cat "${SERVER_LOG}" >&2 || true
  exit 2
fi

# ── 2. install + build SDK + example deps ───────────────────────
if [[ ! -d "${REPO_ROOT}/sdk/js/node/dist" ]]; then
  log "building JS SDK"
  (cd "${REPO_ROOT}" && pnpm --filter "./sdk/js/*" build) >/dev/null
fi
if [[ ! -d "${EXAMPLE_DIR}/node_modules" ]]; then
  log "installing example deps"
  (cd "${EXAMPLE_DIR}" && pnpm install) >/dev/null
fi

# ── 3. start first worker ───────────────────────────────────────
log "starting worker #1 (logs: ${WORKER_LOG})"
(cd "${EXAMPLE_DIR}" && pnpm start) >"${WORKER_LOG}" 2>&1 &
WORKER_PID=$!

# wait for "worker ready" line
for _ in $(seq 1 120); do
  if grep -q "Connected to server" "${WORKER_LOG}" 2>/dev/null; then
    break
  fi
  sleep 0.25
done
if ! grep -q "Connected to server" "${WORKER_LOG}" 2>/dev/null; then
  err "worker #1 failed to come up"
  cat "${WORKER_LOG}" >&2 || true
  exit 2
fi

# ── 4. fire the event ───────────────────────────────────────────
log "emitting doc.received docId=${DOC_ID}"
(cd "${EXAMPLE_DIR}" && pnpm exec tsx scripts/trigger.ts "${DOC_ID}" "${IMAGE_URL}") >>"${WORKER_LOG}" 2>&1

# ── 5. kill worker mid-OCR ──────────────────────────────────────
log "sleeping ${KILL_AFTER_MS}ms then kill -9 worker #1 (mid-OCR)"
SLEEP_S=$(awk -v ms="${KILL_AFTER_MS}" 'BEGIN { printf "%f", ms / 1000 }')
sleep "${SLEEP_S}"
kill -9 "${WORKER_PID}" 2>/dev/null || true
wait "${WORKER_PID}" 2>/dev/null || true
unset WORKER_PID
log "worker #1 killed"

# ── 6. restart worker ───────────────────────────────────────────
log "starting worker #2 (logs: ${WORKER2_LOG})"
(cd "${EXAMPLE_DIR}" && pnpm start) >"${WORKER2_LOG}" 2>&1 &
WORKER2_PID=$!

for _ in $(seq 1 120); do
  if grep -q "Connected to server" "${WORKER2_LOG}" 2>/dev/null; then
    break
  fi
  sleep 0.25
done
if ! grep -q "Connected to server" "${WORKER2_LOG}" 2>/dev/null; then
  err "worker #2 failed to come up"
  cat "${WORKER2_LOG}" >&2 || true
  exit 2
fi

# ── 7. assert recovery ──────────────────────────────────────────
log "verifying projection contains docId=${DOC_ID}"
if (cd "${EXAMPLE_DIR}" && pnpm exec tsx scripts/verify.ts "${DOC_ID}"); then
  log "✅ doc-processor recovered after kill -9"
  exit 0
else
  err "❌ projection never saw docId=${DOC_ID} after restart"
  echo "── server log ──" >&2
  tail -50 "${SERVER_LOG}" >&2 || true
  echo "── worker #2 log ──" >&2
  tail -50 "${WORKER2_LOG}" >&2 || true
  exit 1
fi
