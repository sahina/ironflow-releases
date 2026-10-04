#!/usr/bin/env bash
# One container, three processes: the Ironflow engine, the pull-mode worker and
# the web server. The engine starts first because it creates or applies the
# API key the other two need.
set -euo pipefail

# A platform volume (Fly) mounts root-owned. Start as root only to hand /data to the app user,
# then run the rest of this script as that user. HOME is reset because gunicorn writes under it.
if [ "$(id -u)" = 0 ]; then
  mkdir -p /data
  # Only when the owner differs: a recursive chown of a full volume on every start is slow.
  # A mount that refuses chown falls through to the writable check below, which says why.
  [ "$(stat -c %u /data)" = "$(id -u app)" ] || chown -R app:app /data || true
  HOME=/home/app exec setpriv --reuid=app --regid=app --init-groups "$0" "$@"
fi

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
deadline=$((SECONDS + 60))
while [ "$SECONDS" -lt "$deadline" ]; do
  if python -c "import urllib.request; urllib.request.urlopen('$IRONFLOW_SERVER_URL/ready', timeout=2)" 2>/dev/null && [ "$SECONDS" -lt "$deadline" ]; then
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

# A seeded key comes from the platform secret store, so nothing is read from the volume and
# nothing is left on it. Without one, the engine writes the key to a file and never to stdout;
# read it into the environment and do not echo it.
if [ -z "${IRONFLOW_API_KEY:-}" ]; then
  if [ -n "${IRONFLOW_BOOTSTRAP_ADMIN_KEY:-}" ]; then
    IRONFLOW_API_KEY="$IRONFLOW_BOOTSTRAP_ADMIN_KEY"
  else
    IRONFLOW_API_KEY="$(python -c "import json,sys; print(json.load(open(sys.argv[1]))['key'])" "$KEY_FILE")"
  fi
fi
export IRONFLOW_API_KEY
# The app has no use for the dashboard password, and the worker and web process inherit this env.
unset IRONFLOW_BOOTSTRAP_ADMIN_PASSWORD

python worker.py & pids+=($!)
gunicorn --bind "0.0.0.0:${PORT:-8000}" app:app & pids+=($!)

# All three must run. When one exits, stop the rest and exit non-zero so the
# host restarts the container. A container with a dead engine must not stay up.
status=0
wait -n || status=$?
shutdown
[ "$status" -eq 0 ] && status=1
exit "$status"
