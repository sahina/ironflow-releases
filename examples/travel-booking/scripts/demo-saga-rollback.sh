#!/usr/bin/env bash
# demo-saga-rollback.sh — the one automated check for this example.
#
# Starts an Ironflow server (--dev) against a throwaway SQLite file, starts the
# worker, forces the card to decline, books a trip, and asserts that both
# reservations were compensated and inventory came back to where it started.
#
# Usage:
#   ./scripts/demo-saga-rollback.sh
#   IRONFLOW_BIN=/path/to/ironflow ./scripts/demo-saga-rollback.sh
#
# Exit codes:
#   0  saga compensated correctly
#   1  it did not
#   2  setup error (no binary, server or worker failed to start)

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLE_DIR="$(cd "${HERE}/.." && pwd)"
REPO_ROOT="$(cd "${EXAMPLE_DIR}/../.." && pwd)"
LOG_DIR="$(mktemp -d -t travel-booking-demo-XXXXXX)"
SERVER_LOG="${LOG_DIR}/server.log"
WORKER_LOG="${LOG_DIR}/worker.log"
SERVER_DB="${LOG_DIR}/ironflow.db"

IRONFLOW_BIN="${IRONFLOW_BIN:-${REPO_ROOT}/build/ironflow}"
# Ephemeral ports so repeat runs don't collide with a stuck previous process.
SERVER_PORT="${IRONFLOW_PORT:-$((30000 + RANDOM % 30000))}"
CHAOS_PORT="${CHAOS_PORT:-$((31000 + RANDOM % 30000))}"
IRONFLOW_SERVER_URL="http://localhost:${SERVER_PORT}"

export IRONFLOW_SERVER_URL
export IRONFLOW_URL="${IRONFLOW_SERVER_URL}"
export CHAOS_PORT

cleanup() {
  set +e
  for pid in "${WORKER_PID:-}" "${SERVER_PID:-}"; do
    [[ -z "$pid" ]] && continue
    kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.1
    done
    kill -KILL "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
  echo "logs preserved at ${LOG_DIR}"
}
trap cleanup EXIT

log() { printf '\033[1;36m[demo]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[demo]\033[0m %s\n' "$*" >&2; }

if [[ ! -x "${IRONFLOW_BIN}" ]]; then
  err "ironflow binary not found at ${IRONFLOW_BIN}"
  # `make build` alone produces a binary that refuses to serve: it needs the
  # embedded dashboard (static/index.html) that `make embed` generates.
  err "build it first: (cd ${REPO_ROOT} && make embed build)"
  exit 2
fi

log "starting server on ${SERVER_PORT} (db: ${SERVER_DB})"
# --db, not IRONFLOW_DATABASE_URL: a sqlite:// URL isn't recognised and the
# server falls through to the postgres path, which then demands a NATS store dir.
# --nats-port -1 takes an ephemeral NATS socket so this can run alongside a dev
# server already holding 4222.
"${IRONFLOW_BIN}" serve --dev \
  --port "${SERVER_PORT}" \
  --db "${SERVER_DB}" \
  --nats-port -1 >"${SERVER_LOG}" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 120); do
  if curl -fsS "${IRONFLOW_SERVER_URL}/health" >/dev/null 2>&1; then break; fi
  sleep 0.25
done
if ! curl -fsS "${IRONFLOW_SERVER_URL}/health" >/dev/null 2>&1; then
  err "server never became healthy"
  tail -50 "${SERVER_LOG}" >&2 || true
  exit 2
fi

log "starting worker (chaos port ${CHAOS_PORT})"
(cd "${EXAMPLE_DIR}" && pnpm exec tsx worker.ts) >"${WORKER_LOG}" 2>&1 &
WORKER_PID=$!

# Wait for ready:true, not merely a reachable port — the chaos server comes up
# before inventory is seeded, and booking against unseeded inventory fails.
worker_ready() {
  curl -fsS "http://localhost:${CHAOS_PORT}/state" 2>/dev/null | grep -q '"ready":true'
}

for _ in $(seq 1 160); do
  if worker_ready; then break; fi
  sleep 0.25
done
if ! worker_ready; then
  err "worker never became ready"
  tail -50 "${WORKER_LOG}" >&2 || true
  exit 2
fi

log "booking a trip with a card that will decline"
if (cd "${EXAMPLE_DIR}" && pnpm exec tsx scripts/verify-rollback.ts); then
  exit 0
else
  err "rollback assertion failed"
  echo "── server log ──" >&2
  tail -50 "${SERVER_LOG}" >&2 || true
  echo "── worker log ──" >&2
  tail -50 "${WORKER_LOG}" >&2 || true
  exit 1
fi
