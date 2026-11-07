# Trace an HTTP event through a pull worker

This fixture checks ADR 0152's first-segment ancestry and linked sleep/retry
segments in compose Jaeger. It uses a local SQLite engine and a Python polling
worker. It creates one run with three assignments and three executed callbacks.

Use the engine and SDK from the same release as this example.
The walkthrough requires Python 3.10+, Docker Compose, and an installed `ironflow`
binary. Commands use fish, from the root of an `ironflow-releases` clone.
The API below runs in loopback-only dev mode with authentication bypassed.
Do not point it at a shared or production server.

```fish
python3 -m venv /tmp/ironflow-trace-venv
/tmp/ironflow-trace-venv/bin/pip install 'ironflow-py[tracing]' -r examples/observability/requirements.txt
docker compose -p ironflow-trace-walkthrough -f examples/observability/compose.yaml up -d
set -gx TRACE_STATE (mktemp -d)
env IRONFLOW_OTEL_ENDPOINT=localhost:4317 IRONFLOW_OTEL_SERVICE_NAME=walkthrough-engine IRONFLOW_OTEL_SAMPLE_RATE=1 ironflow serve --dev --host 127.0.0.1 --port 9123 --nats-port -1 --db "$TRACE_STATE/ironflow.db"
```

Keep the engine running. In a second terminal, start the worker and wait for its
registration before emitting. Each OTel provider uses a distinct service name.

```fish
env IRONFLOW_SERVER_URL=http://localhost:9123 /tmp/ironflow-trace-venv/bin/python examples/observability/worker.py
```

In a third terminal, check registration, then emit and verify. The Jaeger v3 services endpoint must return JSON, and the function must
appear in the registration response before running the verifier.

```fish
curl -fsS http://localhost:16686/api/v3/services
curl -fsS http://localhost:9123/ironflow.v1.IronflowService/ListFunctions \
  -H 'Content-Type: application/json' -d '{}'
python3 examples/observability/verify.py --output /tmp/ironflow-trace-evidence
```

The verifier sends a sampled W3C parent to `IronflowService/Emit` over HTTP.
The default `POST /api/v1/events` route no longer emits events.
It queries `/api/v3/traces` with a service name and bounded RFC 3339 time range.
The result envelope contains OTLP `resourceSpans`; the verifier retains those in
`traces.json`. It requires the run to complete on attempt 2, then waits up to 90 seconds for export and indexing and writes `request.json`, `emit.json`,
`run.json`, `traces.json`, and a passing `summary.json` to a new output directory. A failure
exits nonzero with its last topology assertion. Use a new directory for each run.

Open <http://localhost:16686>. Find the three trace IDs from `summary.json`, or
search service `walkthrough-engine` with tag `run.id` from `emit.json`'s `runIds`.
The first trace contains the HTTP server span, `Run: trace-walkthrough`, the
worker's `process`, and its `step.run`. Assignment spans end at handoff, so a
worker child can outlast its engine parent.

The sleep-resume trace has a root assignment linked to the first assignment.
Its callback intentionally fails. The retry trace has a root assignment linked
to both the first and preceding assignments. Select the root span's references
in Jaeger to navigate back. Links point from later segments to earlier ones;
open the returned trace IDs to navigate forward if the viewer has no reverse
link search. A link is not a parent-child edge.

`topology.py` checks Jaeger v3 OTLP JSON using native `parentSpanId` and `links` fields.
It identifies the HTTP emit span by the bounded service-mount route and its
`rpc.service` and `rpc.method` attributes. It requires assignment attempts
`[1, 1, 2]`, the first assignment to parent on `eventtrigger.Emit` beneath that
HTTP span, each SDK process
to be a direct child of its assignment, and each executed step to be a child of
that process. It counts all process and callback spans across the selected
traces before checking ancestry, so orphan spans and repeated memoized
callbacks fail the check. Only the intentionally failed process and callback
may have OTLP error status. This proves the scoped topology when the live command
passes; unit tests of the checker alone do not prove SDK or engine behavior.

The verifier can check Go or Node workers with `--worker-service NAME`, provided
they register the same function ID, event, two step names, 2s durable sleep, and
fail the post-sleep callback on attempt 1 only. Stop the Python worker first.
Those SDKs share the `process` and `step.run` names. This directory supplies only
the Python live worker; it does not claim a live Go, Node, streaming, push,
crash-recovery, unsampled, or panic test.

The fixture uses the [Jaeger v3 query API](https://www.jaegertracing.io/docs/2.22/architecture/apis/).
Run checker and query-contract tests without Docker or an SDK install.

```fish
python3 -m unittest discover -s examples/observability -p 'test_*.py' -v
```

Stop the worker and engine with Ctrl-C so their providers flush. Stop this
fixture's Jaeger separately. Jaeger uses in-memory storage; stopping it loses
traces, so retain the JSON evidence first.

```fish
docker compose -p ironflow-trace-walkthrough -f examples/observability/compose.yaml down
```
