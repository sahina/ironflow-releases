# Flask + Ironflow in one container

A Flask API that uses Ironflow as its backend, packaged as one deployable unit: one
image, one container, one volume.

## Run it

Run these Bash commands from `examples/flask-single-container`. `/healthz` checks the web process. `/readyz` checks the
engine's readiness, an authenticated query, and the `process-order` registration needed
to accept an order. Registration may persist across a restart; readiness does not prove
that a worker completed any work. The completion check below proves that separately.

```bash
set -euo pipefail
BASE=http://127.0.0.1:8000

wait_ready() {
  local deadline=$((SECONDS + 90))
  while [ "$SECONDS" -lt "$deadline" ]; do
    [ "$(docker inspect -f '{{.State.Running}}' flask-ironflow)" = true ] || {
      echo "FAIL: container exited before application readiness" >&2; return 1;
    }
    if curl --connect-timeout 1 --max-time 5 -sf "$BASE/readyz" >/dev/null && [ "$SECONDS" -lt "$deadline" ]; then return 0; fi
    sleep 1
  done
  echo "FAIL: application not ready in 90s; check engine, auth, and function registration" >&2
  return 1
}

wait_completed() {
  local deadline=$((SECONDS + 30)) result status
  while [ "$SECONDS" -lt "$deadline" ]; do
    result=$(curl --connect-timeout 1 --max-time 2 -sf "$BASE/orders/$1") || {
      echo "FAIL: cannot read run $1; do not resubmit the order" >&2; return 1;
    }
    status=$(printf '%s' "$result" | python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])')
    if [ "$status" = completed ] && [ "$SECONDS" -lt "$deadline" ]; then
      printf '%s' "$result" | python3 -c 'import json,sys; r=json.load(sys.stdin); assert r["output"] == {"order_id": "o-1", "receipt": "r-o-1", "total": 108.0}, r'
      return $?
    fi
    [ "$status" != failed ] || { echo "FAIL: run $1 failed" >&2; return 1; }
    sleep 1
  done
  echo "FAIL: run $1 did not complete in 30s" >&2
  return 1
}

docker build -t flask-ironflow:local .
docker run -d --name flask-ironflow -p 127.0.0.1:8000:8000 -v flask-ironflow-data:/data flask-ironflow:local
wait_ready

# Submit once. A lost response or 503 may still mean an event was recorded.
accepted=$(curl --connect-timeout 1 --max-time 5 -sf -X POST "$BASE/orders" \
  -H 'Content-Type: application/json' -d '{"order_id": "o-1", "amount": 100}') || {
  echo "FAIL: acceptance unknown; inspect existing state before resubmitting" >&2; exit 1;
}
run_id=$(printf '%s' "$accepted" | python3 -c 'import json,sys; print(json.load(sys.stdin)["run_id"])')
wait_completed "$run_id"

docker restart flask-ironflow
wait_ready
wait_completed "$run_id"  # Read the same completed run and expected result from the volume.
```

On failure, inspect container logs without exposing credentials. Keep the operation ID and
reconcile its state before submitting again. A 202 response reports acceptance; it is not
completion. Report unavailable checks as unverified, including startup readiness, acceptance,
completion, and post-restart persistence when they could not be run.

`./test.sh` runs the full proof. From the repository root: `make test-example-flask-container`.

## How it works

The Ironflow engine is one static binary. The `Dockerfile` copies it from the pinned
engine image into a Python image. `entrypoint.sh` then does these steps in order:

1. Start `ironflow serve` on `127.0.0.1:9123` with its database under `/data`.
2. Wait for engine `/ready` with a 60-second deadline and a 2-second probe timeout.
   Stop with an error if the engine exits or the deadline expires.
3. Take the API key: from `IRONFLOW_BOOTSTRAP_ADMIN_KEY` when you seeded one, otherwise from
   `/data/.ironflow_bootstrap_key.json`. It goes into `IRONFLOW_API_KEY`. The dashboard password
   is dropped from the environment before the app starts.
4. Start the pull-mode worker (`worker.py`) and the web server (`gunicorn app:app`).
5. Wait for the first process that exits, stop the others, and exit non-zero.

After startup and restart, wait for application `/readyz` before using application routes.

Only port 8000 is published. The engine API stays on loopback inside the container.

## Known limits

- **One instance only.** Two containers are two engines with two separate data sets.
- **A volume on `/data` is mandatory.** Without one, every `docker rm` deletes all runs and events.
- **The dashboard is not reachable** from outside the container.
- **The bootstrap key stays on the volume unless you seed it.** Set `IRONFLOW_BOOTSTRAP_ADMIN_KEY` (and `IRONFLOW_BOOTSTRAP_ADMIN_PASSWORD`) as secrets and the engine writes no key file. Seeding needs an engine release that supports it; check with `ironflow serve --help`.
- **A restart stops the engine.** There is no zero-downtime deploy.
- For more than one instance, use PostgreSQL and the [Docker Compose](https://docs.ironflow.run/how-to-guides/deployment/docker-compose/) or Helm path.

## Versions

`ironflow-py` and the engine image are pinned to the same release (0.40.0). Move them together.
