#!/usr/bin/env bash
# demo-crash-resume.sh — literal script behind `make demo-reconciliation-crash`.
#
# Proves the outbound contact is idempotent across a real mid-send crash:
# starts a server and worker, triggers a statement, approves one case,
# kill -9s the worker WHILE the provider call is in flight, restarts, and
# asserts the provider ledger holds exactly one delivery for that key.
#
# Usage:
#   ./scripts/demo-crash-resume.sh
#   IRONFLOW_BIN=/path/to/ironflow ./scripts/demo-crash-resume.sh
#
# Exit codes:
#   0  exactly one delivery after the crash
#   1  duplicate or missing delivery
#   2  setup error
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLE_DIR="$(cd "${HERE}/.." && pwd)"
REPO_ROOT="$(cd "${EXAMPLE_DIR}/../../.." && pwd)"
LOG_DIR="$(mktemp -d -t reconciliation-demo-XXXXXX)"
SERVER_LOG="${LOG_DIR}/server.log"
WORKER_LOG="${LOG_DIR}/worker.log"
WORKER2_LOG="${LOG_DIR}/worker-resume.log"
SERVER_DB="${LOG_DIR}/ironflow.db"
LEDGER="${LOG_DIR}/contact-ledger.jsonl"

IRONFLOW_BIN="${IRONFLOW_BIN:-${REPO_ROOT}/build/ironflow}"
SERVER_PORT="${IRONFLOW_PORT:-$((30000 + RANDOM % 30000))}"
IRONFLOW_URL="${IRONFLOW_URL:-http://localhost:${SERVER_PORT}}"

# The provider "accepts" then stalls for this long. The kill lands inside
# that window — after acceptance, before the step result persists. That is
# the ONLY window where memoization alone lets a second send through.
SEND_MS="${DEMO_SEND_MS:-4000}"
KILL_AFTER_MS="${DEMO_KILL_AFTER_MS:-2000}"

export CONTACT_LEDGER="${LEDGER}"
export CONTACT_SEND_MS="${SEND_MS}"
export IRONFLOW_URL
export IRONFLOW_SERVER_URL="${IRONFLOW_URL}"
: >"${LEDGER}"

cleanup() {
  set +e
  for pid in "${WORKER_PID:-}" "${WORKER2_PID:-}" "${SERVER_PID:-}"; do
    [[ -z "$pid" ]] && continue
    is_worker=""
    [[ "$pid" == "${WORKER_PID:-}" || "$pid" == "${WORKER2_PID:-}" ]] && is_worker=1
    if kill -0 "$pid" 2>/dev/null; then
      kill -TERM "$pid" 2>/dev/null || true
      for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
      kill -KILL "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
    # Group sweep for workers only, outside the liveness guard: the wrapper
    # exiting while its tsx grandchild keeps polling is exactly the orphan
    # case. `-$SERVER_PID` would name a group the server does not own.
    [[ -n "$is_worker" ]] && kill -KILL -- "-$pid" 2>/dev/null
    true
  done
  echo
  echo "logs preserved at ${LOG_DIR}"
}
trap cleanup EXIT

log() { printf '\033[1;36m[demo]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[demo]\033[0m %s\n' "$*" >&2; }

start_worker() {  # $1 = log file, sets WORKER_STARTED_PID
  set -m
  (cd "${EXAMPLE_DIR}" && pnpm start) >"$1" 2>&1 &
  WORKER_STARTED_PID=$!
  set +m
  for _ in $(seq 1 120); do
    grep -q "Connected to server" "$1" 2>/dev/null && return 0
    sleep 0.25
  done
  err "worker failed to come up"; cat "$1" >&2 || true; exit 2
}

# ── 0. preconditions ────────────────────────────────────────────
if [[ ! -x "${IRONFLOW_BIN}" ]]; then
  err "ironflow binary not found at ${IRONFLOW_BIN}"
  err "build it first: (cd ${REPO_ROOT} && make embed build)"
  exit 2
fi

# ── 1. server ───────────────────────────────────────────────────
# --nats-port -1 takes an ephemeral port for embedded NATS. Without it the
# demo binds the 4222 default and dies on "NATS port 4222 is already in use"
# whenever a `ironflow serve` from the README's quick start is still up —
# randomizing --port alone is not isolation. --nats-store-dir derives from
# --db, which is already unique per run.
log "starting server (port ${SERVER_PORT}, db ${SERVER_DB})"
"${IRONFLOW_BIN}" serve --dev --port "${SERVER_PORT}" --nats-port -1 --db "${SERVER_DB}" >"${SERVER_LOG}" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 60); do curl -fs "${IRONFLOW_URL}/health" >/dev/null 2>&1 && break; sleep 0.5; done
if ! curl -fs "${IRONFLOW_URL}/health" >/dev/null 2>&1; then
  err "server failed to come up"; cat "${SERVER_LOG}" >&2 || true; exit 2
fi

# ── 2. deps ─────────────────────────────────────────────────────
if [[ ! -d "${REPO_ROOT}/sdk/js/node/dist" ]]; then
  log "building JS SDK"
  (cd "${REPO_ROOT}" && pnpm --filter "./sdk/js/*" build) >/dev/null
fi
if [[ ! -d "${EXAMPLE_DIR}/node_modules" ]]; then
  log "installing example deps"
  (cd "${EXAMPLE_DIR}" && pnpm install) >/dev/null
fi

# ── 3. worker #1 ────────────────────────────────────────────────
log "starting worker #1"
start_worker "${WORKER_LOG}"; WORKER_PID="${WORKER_STARTED_PID}"

# ── 4. trigger, then approve one case ───────────────────────────
log "verifying case reuse across concurrent statements"
(cd "${EXAMPLE_DIR}" && pnpm exec tsx scripts/verify-case-reuse.ts) >>"${WORKER_LOG}" 2>&1

# The case runs are detached, so wait for one to reach its approval gate,
# then approve it by run id. scripts/find-pending.ts prints the first run id
# sitting at approve.contact.
log "waiting for a case to reach the approval gate"
RUN_ID=""
for _ in $(seq 1 120); do
  RUN_ID="$(cd "${EXAMPLE_DIR}" && pnpm exec tsx scripts/find-pending.ts 2>/dev/null || true)"
  [[ -n "${RUN_ID}" ]] && break
  sleep 0.5
done
if [[ -z "${RUN_ID}" ]]; then
  err "no case reached the approval gate"; tail -50 "${WORKER_LOG}" >&2 || true; exit 2
fi
log "approving run ${RUN_ID}"
(cd "${EXAMPLE_DIR}" && pnpm exec tsx scripts/approve.ts "${RUN_ID}" true) >>"${WORKER_LOG}" 2>&1

# ── 5. kill mid-send ────────────────────────────────────────────
log "sleeping ${KILL_AFTER_MS}ms then kill -9 worker #1 (mid-send)"
sleep "$(awk -v ms="${KILL_AFTER_MS}" 'BEGIN { printf "%f", ms / 1000 }')"
kill -9 -- "-${WORKER_PID}" 2>/dev/null || kill -9 "${WORKER_PID}" 2>/dev/null || true
wait "${WORKER_PID}" 2>/dev/null || true
unset WORKER_PID
log "worker #1 killed"

# The provider must already have accepted — otherwise the kill landed
# before the send and the run below re-sends legitimately, testing nothing.
ACCEPTED="$(wc -l <"${LEDGER}" | tr -d ' ')"
if [[ "${ACCEPTED}" -lt 1 ]]; then
  err "kill landed before the provider accepted — raise DEMO_SEND_MS or lower DEMO_KILL_AFTER_MS"
  exit 2
fi

# ── 6. worker #2 ────────────────────────────────────────────────
log "starting worker #2"
start_worker "${WORKER2_LOG}"; WORKER2_PID="${WORKER_STARTED_PID}"

# ── 7. wait for the APPROVED run's own send step to re-execute ──
# Crash recovery goes through the scheduler's stale-claim reclaim sweep, not
# an instant redispatch (~50s even in --dev, cmd/ironflow/serve.go) — a
# short fixed sleep proves nothing (worker #2 never even polls the job in
# time) and a ledger-wide count can't tell "this run resumed and deduped"
# from "this run never resumed and a DIFFERENT approved case sent instead".
# Poll the target run's own send step instead.
log "waiting for run ${RUN_ID}'s send step to complete after resume"
SEND_OUTPUT="$(cd "${EXAMPLE_DIR}" && pnpm exec tsx scripts/wait-for-send.ts "${RUN_ID}")" || {
  err "run ${RUN_ID} never completed its send step after restart"
  tail -50 "${WORKER2_LOG}" >&2 || true
  exit 2
}
log "run ${RUN_ID} send step output: ${SEND_OUTPUT}"

TOTAL="$(wc -l <"${LEDGER}" | tr -d ' ')"
UNIQUE="$(awk -F'"key":"' '{split($2,a,"\""); print a[1]}' "${LEDGER}" | sort -u | wc -l | tr -d ' ')"
log "ledger: ${TOTAL} deliveries, ${UNIQUE} unique keys"

# ── 8. assert ────────────────────────────────────────────────────
# Two independent checks: (a) the ledger never holds two rows for the same
# key — a whole-file sanity check; (b) the APPROVED run's own send step,
# re-executed post-crash, reports deduped:true — proof that THIS run's
# memoized-but-not-yet-persisted send did not re-deliver.
if [[ "${TOTAL}" -ne "${UNIQUE}" ]]; then
  err "❌ duplicate delivery after restart: ${TOTAL} rows, ${UNIQUE} unique keys"
  err "the idempotency key is not reaching the provider — this is the real bug"
  cat "${LEDGER}" >&2 || true
  tail -50 "${WORKER2_LOG}" >&2 || true
  exit 1
fi
if [[ "${SEND_OUTPUT}" != *'"deduped":true'* ]]; then
  err "❌ run ${RUN_ID}'s post-resume send step did not report deduped:true (${SEND_OUTPUT})"
  err "the resumed step re-sent instead of hitting the provider-side idempotency key"
  exit 1
fi

log "✅ no duplicate send across kill -9 (${TOTAL} delivery/deliveries, all unique; approved run deduped on resume)"
exit 0
