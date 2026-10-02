# Flask + Ironflow in one container

A Flask API that uses Ironflow as its backend, packaged as one deployable unit: one
image, one container, one volume.

## Run it

```bash
docker build -t flask-ironflow .
docker run -d --name flask-ironflow -p 8000:8000 -v flask-ironflow-data:/data flask-ironflow

curl -X POST localhost:8000/orders -H 'Content-Type: application/json' \
  -d '{"order_id": "o-1", "amount": 100}'
# {"event_id": "...", "run_id": "..."}

curl localhost:8000/orders/<run_id>
# {"output": {"order_id": "o-1", "receipt": "r-o-1", "total": 108.0}, "run_id": "...", "status": "completed"}
```

`./test.sh` runs the full proof. From the repository root: `make test-example-flask-container`.

## How it works

The Ironflow engine is one static binary. The `Dockerfile` copies it from the pinned
engine image into a Python image. `entrypoint.sh` then does these steps in order:

1. Start `ironflow serve` on `127.0.0.1:9123` with its database under `/data`.
2. Wait for `/ready`. Stop with an error after 60 seconds.
3. Read the API key from `/data/.ironflow_bootstrap_key.json` into `IRONFLOW_API_KEY`.
4. Start the pull-mode worker (`worker.py`) and the web server (`gunicorn app:app`).
5. Wait for the first process that exits, stop the others, and exit non-zero.

Only port 8000 is published. The engine API stays on loopback inside the container.

## Known limits

- **One instance only.** Two containers are two engines with two separate data sets.
- **A volume on `/data` is mandatory.** Without one, every `docker rm` deletes all runs and events.
- **The dashboard is not reachable** from outside the container.
- **The bootstrap key stays on the volume.** The [API keys guide](https://docs.ironflow.run/how-to-guides/security/api-keys/) says to read it once, delete the file and rotate. This recipe does not.
- **A restart stops the engine.** There is no zero-downtime deploy.
- For more than one instance, use PostgreSQL and the [Docker Compose](https://docs.ironflow.run/how-to-guides/deployment/docker-compose/) or Helm path.

## Versions

`ironflow-py` and the engine image are pinned to the same release (0.40.0). Move them together.
