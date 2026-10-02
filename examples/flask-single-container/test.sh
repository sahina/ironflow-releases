#!/usr/bin/env bash
# Proves the single-container recipe: the image builds, a durable run completes,
# state survives a restart, the key stays out of the logs, and a dead engine
# stops the container.
set -euo pipefail
cd "$(dirname "$0")"

IMAGE=ironflow-flask-single:test
NAME=ironflow-flask-single-test
VOLUME=ironflow-flask-single-test-data
PORT="${FLASK_EXAMPLE_PORT:-18000}"
BASE="http://127.0.0.1:$PORT"
TMP="$(mktemp -d)"

fail() {
  echo "FAIL: $*" >&2
  docker logs "$NAME" 2>&1 | tail -40 >&2 || true
  exit 1
}
cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker volume rm "$VOLUME" >/dev/null 2>&1 || true

# Prove the ignore rules protect COPY . ., including nested credential files.
mkdir -p "$TMP/context/nested"
cp .dockerignore "$TMP/context/.dockerignore"
touch "$TMP/context/keep"
for dir in "$TMP/context" "$TMP/context/nested"; do
  touch "$dir/.env" "$dir/.env.local" "$dir/.env.production"
done
printf 'FROM scratch\nCOPY . .\n' | docker build -q -f - \
  --output "type=local,dest=$TMP/export" "$TMP/context" >/dev/null
[ -f "$TMP/export/keep" ] || fail "build-context probe did not copy files"
[ -z "$(find "$TMP/export" -name '.env*' -print -quit)" ] || fail "credential file survived COPY . ."

docker build -q -t "$IMAGE" . >/dev/null

# SIGTERM while the engine is still booting must stop the container at once (exit 143). With
# no trap yet, PID 1 ignores SIGTERM and docker has to SIGKILL it (exit 137) after the timeout.
# The real engine is ready in about a second, so a fake one that never answers /ready holds the
# entrypoint in its readiness wait.
BOOT="$NAME-boot"
printf '#!/bin/sh\nexec sleep 300\n' > "$TMP/ironflow"
chmod +x "$TMP/ironflow"
docker rm -f "$BOOT" >/dev/null 2>&1 || true
docker run -d --name "$BOOT" -v "$TMP/ironflow:/usr/local/bin/ironflow:ro" "$IMAGE" >/dev/null
sleep 2
docker stop -t 8 "$BOOT" >/dev/null
boot_exit=$(docker inspect -f '{{.State.ExitCode}}' "$BOOT")
docker rm -f "$BOOT" >/dev/null 2>&1 || true
[ "$boot_exit" = 143 ] || fail "SIGTERM during startup exited $boot_exit, want 143 (the entrypoint has no trap yet)"
docker run -d --name "$NAME" -p "127.0.0.1:$PORT:8000" -v "$VOLUME:/data" "$IMAGE" >/dev/null

wait_healthy() {
  for _ in $(seq 1 90); do
    curl -sf "$BASE/healthz" >/dev/null && return 0
    sleep 1
  done
  fail "app did not answer /healthz in 90s"
}

# 503 is the documented "worker not registered yet" answer. Any other status
# that is not 202 is a failure.
place_order() {
  local code
  for _ in $(seq 1 30); do
    code=$(curl -s -o "$TMP/order.json" -w '%{http_code}' -X POST "$BASE/orders" \
      -H 'Content-Type: application/json' -d "{\"order_id\":\"$1\",\"amount\":100}")
    case "$code" in
      202) python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["run_id"])' "$TMP/order.json"; return 0 ;;
      503) sleep 1 ;;
      *) fail "POST /orders returned $code: $(cat "$TMP/order.json")" ;;
    esac
  done
  fail "POST /orders still 503 after 30s"
}

wait_completed() {
  local status=unknown
  for _ in $(seq 1 30); do
    status=$(curl -sf "$BASE/orders/$1" | python3 -c 'import sys,json; print(json.load(sys.stdin)["status"])')
    [ "$status" = completed ] && return 0
    [ "$status" = failed ] && fail "run $1 failed"
    sleep 1
  done
  fail "run $1 not completed in 30s (last status: $status)"
}

wait_healthy

# The 503 branch, deterministically: stub the emit so it matches no function, as it does
# before the worker registers. The race in place_order below only exercises it by luck.
docker exec -i "$NAME" python - <<'PY' || fail "an event that starts no run must answer 503"
import types
import app as flask_app


class StubRPC:
    events = types.SimpleNamespace(emit=lambda _req: types.SimpleNamespace(run_ids=[], event_id="e"))

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


flask_app._rpc = StubRPC
r = flask_app.app.test_client().post("/orders", json={"order_id": "x", "amount": 1})
assert r.status_code == 503, r.status_code
assert "worker not registered" in r.get_json()["error"], r.get_json()
PY

run_id=$(place_order o-1)
wait_completed "$run_id"
total=$(curl -sf "$BASE/orders/$run_id" | python3 -c 'import sys,json; print(json.load(sys.stdin)["output"]["total"])')
[ "$total" = "108.0" ] || fail "expected total 108.0, got $total"

code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/orders/no-such-run")
[ "$code" = 404 ] || fail "unknown run id returned $code, want 404"

for body in '{}' '[1]' '"order"' '1' 'true' 'null'; do
  code=$(curl -s -o "$TMP/invalid.json" -w '%{http_code}' -X POST "$BASE/orders" \
    -H 'Content-Type: application/json' -d "$body")
  [ "$code" = 400 ] || fail "invalid order $body returned $code, want 400"
  python3 -c 'import json,sys; assert "body must be" in json.load(open(sys.argv[1]))["error"]' "$TMP/invalid.json"
done

[ "$(docker port "$NAME" | wc -l | tr -d ' ')" = 1 ] || fail "more than one port is published: $(docker port "$NAME")"
# The engine banner prints an 8-character key prefix ("ifkey_78e548b5..."). A full key is
# "ifkey_" plus 32 characters, so match that.
key_in_logs() { docker logs "$NAME" 2>&1 | grep -qE 'ifkey_[A-Za-z0-9]{16,}'; }
if key_in_logs; then fail "the API key is in the container logs"; fi

docker restart "$NAME" >/dev/null
wait_healthy
wait_completed "$run_id"   # the earlier run survived the restart
# A separate assignment: errexit does not see a failure inside "$(...)" in an argument.
run_id_2=$(place_order o-2)
wait_completed "$run_id_2" # the key file was read again and still works
if key_in_logs; then fail "the API key is in the container logs after a restart"; fi

# A dead engine must stop the container, so the host restarts the unit.
docker exec "$NAME" sh -c 'for p in /proc/[0-9]*; do [ "$(cat "$p/comm" 2>/dev/null)" = ironflow ] && kill -9 "${p#/proc/}"; done; true'
for _ in $(seq 1 30); do
  [ "$(docker inspect -f '{{.State.Running}}' "$NAME")" = false ] && break
  sleep 1
done
[ "$(docker inspect -f '{{.State.Running}}' "$NAME")" = false ] || fail "container still runs after the engine died"
[ "$(docker inspect -f '{{.State.ExitCode}}' "$NAME")" != 0 ] || fail "container exited 0 after the engine died"

echo "PASS: flask-single-container"
