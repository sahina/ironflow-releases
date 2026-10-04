#!/usr/bin/env bash
# Proves the single-container recipe: the image builds, a durable run completes,
# state survives a restart, the key stays out of the logs, and a dead engine
# stops the container.
set -euo pipefail
cd "$(dirname "$0")"

IMAGE=ironflow-flask-single:test
NAME=ironflow-flask-single-test
VOLUME=ironflow-flask-single-test-data
SEED_NAME="$NAME-seed"
SEED_VOLUME="$VOLUME-seed"
PORT="${FLASK_EXAMPLE_PORT:-18000}"
BASE="http://127.0.0.1:$PORT"
TMP="$(mktemp -d)"

fail() {
  echo "FAIL: $*" >&2
  docker logs "$NAME" 2>&1 | tail -40 | sed -E 's/ifkey_[A-Za-z0-9]{16,}/[redacted API key]/g; s/seed-dashboard-pass/[redacted dashboard password]/g' >&2 || true
  docker logs "$SEED_NAME" 2>&1 | tail -40 | sed -E 's/ifkey_[A-Za-z0-9]{16,}/[redacted API key]/g; s/seed-dashboard-pass/[redacted dashboard password]/g' >&2 || true
  exit 1
}
cleanup() {
  docker rm -f "$NAME" "$SEED_NAME" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME" "$SEED_VOLUME" >/dev/null 2>&1 || true
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

# The pinned engine image predates key seeding, so the seeded case needs the
# engine under test. `make test-example-flask-container` builds it and sets this.
ENGINE_IMAGE="${ENGINE_IMAGE:-}"
build_args=()
[ -n "$ENGINE_IMAGE" ] && build_args=(--build-arg "ENGINE_IMAGE=$ENGINE_IMAGE")
# The expansion form keeps an empty array legal under `set -u` on bash 3.2.
docker build -q -t "$IMAGE" ${build_args[@]+"${build_args[@]}"} . >/dev/null

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

wait_ready() {
  local deadline=$((SECONDS + 90))
  while [ "$SECONDS" -lt "$deadline" ]; do
    [ "$(docker inspect -f '{{.State.Running}}' "${2:-$NAME}")" = true ] || fail "container exited before application readiness"
    if curl --connect-timeout 1 --max-time 5 -sf "${1:-$BASE}/readyz" >/dev/null && [ "$SECONDS" -lt "$deadline" ]; then return 0; fi
    sleep 1
  done
  fail "application not ready in 90s: engine, authentication, or process-order registration unavailable"
}

# Submit once. An event may have been recorded even if the response is lost or is 503.
place_order() {
  local code
  code=$(curl --connect-timeout 1 --max-time 5 -s -o "$TMP/order.json" -w '%{http_code}' -X POST "$BASE/orders" \
    -H 'Content-Type: application/json' -d "{\"order_id\":\"$1\",\"amount\":100}") || fail "order acceptance unknown; inspect state before resubmitting"
  [ "$code" = 202 ] || fail "POST /orders returned $code; not retried"
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["run_id"])' "$TMP/order.json"
}

wait_completed() {
  local status=unknown
  local deadline=$((SECONDS + 30))
  while [ "$SECONDS" -lt "$deadline" ]; do
    status=$(curl --connect-timeout 1 --max-time 2 -sf "$BASE/orders/$1" | python3 -c 'import sys,json; print(json.load(sys.stdin)["status"])')
    [ "$status" = completed ] && [ "$SECONDS" -lt "$deadline" ] && return 0
    [ "$status" = failed ] && fail "run $1 failed"
    sleep 1
  done
  fail "run $1 not completed in 30s (last status: $status)"
}

# Prove readiness stays false before registration, independently of web liveness.
# Also prove an accepted event with no matching function is not reported as a run.
docker exec -i "$NAME" python - <<'PY' || fail "readiness or unmatched-event contract failed"
import contextlib
import os
import types
import app as flask_app


class StubRPC:
    @staticmethod
    def missing_function(*_args, **_kwargs):
        raise flask_app.IronflowRPCError("not registered", code="not_found")

    functions = types.SimpleNamespace(get=missing_function)
    events = types.SimpleNamespace(emit=lambda _req: types.SimpleNamespace(run_ids=[], event_id="e"))

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


os.environ["IRONFLOW_SERVER_URL"] = "http://127.0.0.1:9123"
flask_app.urllib.request.urlopen = lambda *_args, **_kwargs: contextlib.nullcontext()
flask_app._rpc = StubRPC
assert flask_app.app.test_client().get("/healthz").status_code == 200
assert flask_app.app.test_client().get("/readyz").status_code == 503
StubRPC.functions = types.SimpleNamespace(get=lambda *_args, **_kwargs: object())
assert flask_app.app.test_client().get("/readyz").status_code == 200


def engine_unavailable(*_args, **_kwargs):
    raise flask_app.urllib.error.URLError("engine not ready")


flask_app.urllib.request.urlopen = engine_unavailable
assert flask_app.app.test_client().get("/readyz").status_code == 503
r = flask_app.app.test_client().post("/orders", json={"order_id": "x", "amount": 1})
assert r.status_code == 503, r.status_code
assert "worker not registered" in r.get_json()["error"], r.get_json()
PY

wait_ready
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
key_in_logs() { docker logs "$NAME" >"$TMP/app.log" 2>&1 || fail "could not collect logs"; grep -qE 'ifkey_[A-Za-z0-9]{16,}' "$TMP/app.log"; }
if key_in_logs; then fail "the API key is in the container logs"; fi

docker restart "$NAME" >/dev/null
wait_ready
wait_completed "$run_id"   # the earlier run survived the restart
restored_total=$(curl --connect-timeout 1 --max-time 2 -sf "$BASE/orders/$run_id" | python3 -c 'import sys,json; print(json.load(sys.stdin)["output"]["total"])')
[ "$restored_total" = "$total" ] || fail "persisted output changed after restart"
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

# --- Seeded key: the platform secret is the source of truth. ---
if [ -n "$ENGINE_IMAGE" ]; then
  SEED_PORT=$((PORT + 1))
  KEY_A="ifkey_0123456789abcdef0123456789abcdef"
  KEY_B="ifkey_fedcba9876543210fedcba9876543210"
  SEED_PASS=seed-dashboard-pass

  run_seeded() { # $1 = key
    docker rm -f "$SEED_NAME" >/dev/null 2>&1 || true
    docker run -d --name "$SEED_NAME" -p "127.0.0.1:$SEED_PORT:8000" -v "$SEED_VOLUME:/data" \
      -e "IRONFLOW_BOOTSTRAP_ADMIN_KEY=$1" -e "IRONFLOW_BOOTSTRAP_ADMIN_PASSWORD=$SEED_PASS" "$IMAGE" >/dev/null
    wait_ready "http://127.0.0.1:$SEED_PORT" "$SEED_NAME"
  }
  # Sets SEEDED_RID. Not a $(...) caller: fail must exit the script, not a subshell.
  seeded_order() { # $1 = order id
    local code=000 status=unknown
    code=$(curl --connect-timeout 1 --max-time 5 -s -o "$TMP/seed-order.json" -w '%{http_code}' -X POST "http://127.0.0.1:$SEED_PORT/orders" \
      -H 'Content-Type: application/json' -d "{\"order_id\":\"$1\",\"amount\":100}") || fail "seeded order acceptance unknown; inspect state before resubmitting"
    [ "$code" = 202 ] || fail "seeded POST /orders returned $code; not retried"
    SEEDED_RID=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["run_id"])' "$TMP/seed-order.json")
    seeded_status_is_completed "$SEEDED_RID" || fail "seeded run $SEEDED_RID did not complete"
  }
  seeded_status_is_completed() { # $1 = run id; polls up to 30s
    local status=unknown
    local deadline=$((SECONDS + 30))
    while [ "$SECONDS" -lt "$deadline" ]; do
      status=$(curl --connect-timeout 1 --max-time 2 -sf "http://127.0.0.1:$SEED_PORT/orders/$1" | python3 -c 'import sys,json; print(json.load(sys.stdin)["status"])') || status=unknown
      [ "$status" = completed ] && [ "$SECONDS" -lt "$deadline" ] && return 0
      [ "$status" = failed ] && fail "seeded run $1 failed"
      sleep 1
    done
    return 1
  }

  # Each negative check below is a function that returns 0 when it SEES the leak, and is
  # proved able to see one first. "grep -q && fail" alone cannot tell "clean" from "the
  # pipeline broke": under pipefail, grep -q exits early, docker logs takes SIGPIPE, and a
  # real match reads as no match. So capture to a file, then grep the file.
  logs_leak() { # $1 = ERE; 0 when a log line matches
    docker logs "$SEED_NAME" >"$TMP/seed.log" 2>&1
    grep -qE "$1" "$TMP/seed.log"
  }
  # Prints "<processes scanned> <processes whose environment holds the password>". There is
  # no pgrep in python:3.14-slim, so walk /proc as the dead-engine step below does. The
  # entrypoint sh's own /proc/<pid>/environ is its start-up environment, so match by comm.
  # `-u app`: the processes run as app after the entrypoint drops root, and a container's root
  # has no CAP_SYS_PTRACE, so it cannot read another uid's environ or /proc/<pid>/fd.
  env_scan() { # $1 = space-separated comm names to scan
    docker exec -u app "$SEED_NAME" sh -c '
      n=0; leaked=0
      for p in /proc/[0-9]*; do
        c=$(cat "$p/comm" 2>/dev/null) || continue
        case " $1 " in *" $c "*) ;; *) continue ;; esac
        n=$((n + 1))
        if tr "\0" "\n" < "$p/environ" 2>/dev/null | grep -q "^IRONFLOW_BOOTSTRAP_ADMIN_PASSWORD="; then leaked=$((leaked + 1)); fi
      done
      echo "$n $leaked"' sh "$1"
  }

  run_seeded "$KEY_A"
  seeded_order s-1
  first_rid=$SEEDED_RID
  # Nothing on the volume: the key was never written.
  docker exec "$SEED_NAME" test ! -e /data/.ironflow_bootstrap_key.json || fail "a seeded key left a key file on the volume"

  # The dashboard password does not ride into the app's environment. The engine keeps it, so
  # it is the control: a scan that cannot find the password there proves nothing about the app.
  out=$(env_scan "ironflow") || fail "env scan failed to run"
  [ "$out" = "1 1" ] || fail "env scan cannot see the password in the engine (got '$out'): the app check is blind"
  out=$(env_scan "gunicorn python") || fail "env scan failed to run"
  read -r scanned leaked <<<"$out"
  [ "$scanned" -ge 2 ] || fail "env scan found $scanned app processes, want the web server and the worker"
  [ "$leaked" = 0 ] || fail "the dashboard password reached $leaked app process(es)"

  # Root, privileged: the container's stdio pipes are root's, and PID 1 runs as app, so opening
  # its fd needs CAP_SYS_PTRACE, which a plain exec does not get.
  docker exec --privileged "$SEED_NAME" sh -c 'echo seed-canary-line > /proc/1/fd/2'
  for _ in $(seq 1 10); do logs_leak seed-canary-line && break; sleep 1; done
  logs_leak seed-canary-line || fail "log scan cannot see a planted line: the log checks are blind"
  if logs_leak "$KEY_A|$SEED_PASS"; then fail "a seeded secret is in the logs"; fi

  # Rotation: same volume, new key. The old run history survives, the new key works.
  run_seeded "$KEY_B"
  seeded_order s-2
  seeded_status_is_completed "$first_rid" || fail "the run from before the rotation is gone"
  docker exec "$SEED_NAME" test ! -e /data/.ironflow_bootstrap_key.json || fail "rotation left a key file on the volume"
  if logs_leak "$KEY_A|$KEY_B|$SEED_PASS"; then fail "a seeded secret is in the logs after rotation"; fi
else
  echo "UNVERIFIED: seeded-key rotation, seeded credential isolation, and seeded persistence require ENGINE_IMAGE with key-seeding support"
fi

echo "PASS: flask-single-container checks executed"
