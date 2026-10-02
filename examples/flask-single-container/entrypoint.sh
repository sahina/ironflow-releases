#!/usr/bin/env bash
# One container, three processes: the Ironflow engine, the pull-mode worker and
# the web server. The engine starts first because it creates the API key the
# other two need.
set -euo pipefail

DATA_DIR=/data
KEY_FILE="$DATA_DIR/.ironflow_bootstrap_key.json"
export IRONFLOW_SERVER_URL=http://127.0.0.1:9123

if [ ! -w "$DATA_DIR" ]; then
  echo "entrypoint: $DATA_DIR is not writable. Mount a volume there." >&2
  exit 1
fi

# Loopback only: the engine API must not be reachable from outside the container.
NATS_STORE_DIR="$DATA_DIR/nats" ironflow serve \
  --host 127.0.0.1 --port 9123 --db "$DATA_DIR/ironflow.db" &
engine=$!

# Installed before the readiness wait: a SIGTERM during startup must stop the engine cleanly.
# PID 1 ignores a signal that has no handler, so docker would SIGKILL the engine mid-boot.
pids=()
# Stop the app before the engine, so the worker can report its last step.
shutdown() {
  if [ "${#pids[@]}" -gt 0 ]; then
    kill -TERM "${pids[@]}" 2>/dev/null || true
    wait "${pids[@]}" 2>/dev/null || true
  fi
  kill -TERM "$engine" 2>/dev/null || true
  wait "$engine" 2>/dev/null || true
}
trap 'shutdown; exit 143' TERM INT

ready=0
for _ in $(seq 1 60); do
  if python -c "import urllib.request; urllib.request.urlopen('$IRONFLOW_SERVER_URL/ready', timeout=2)" 2>/dev/null; then
    ready=1
    break
  fi
  if ! kill -0 "$engine" 2>/dev/null; then
    echo "entrypoint: the engine exited before it was ready" >&2
    exit 1
  fi
  sleep 1
done
if [ "$ready" != 1 ]; then
  echo "entrypoint: the engine was not ready after 60s" >&2
  exit 1
fi

# The engine writes the key to a file and never to stdout. Read it into the
# environment; do not echo it.
IRONFLOW_API_KEY="$(python -c "import json,sys; print(json.load(open(sys.argv[1]))['key'])" "$KEY_FILE")"
export IRONFLOW_API_KEY

python worker.py & pids+=($!)
gunicorn --bind "0.0.0.0:${PORT:-8000}" app:app & pids+=($!)

# All three must run. When one exits, stop the rest and exit non-zero so the
# host restarts the container. A container with a dead engine must not stay up.
status=0
wait -n || status=$?
shutdown
[ "$status" -eq 0 ] && status=1
exit "$status"
