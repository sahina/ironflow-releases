"""Emit through HTTP and verify a running walkthrough worker in Jaeger."""
import argparse
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

from topology import verify


def request(url, body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=5) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server", default="http://localhost:9123")
    parser.add_argument("--jaeger", default="http://localhost:16686")
    parser.add_argument("--engine-service", default="walkthrough-engine")
    parser.add_argument("--worker-service", default="walkthrough-python")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--timeout", type=float, default=90)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    request(args.jaeger + "/api/v3/services")
    started = datetime.now(timezone.utc) - timedelta(seconds=5)
    producer = uuid.uuid4().hex
    traceparent = f"00-{producer}-{uuid.uuid4().hex[:16]}-01"
    body = {"event": "trace.walkthrough", "data": {}}
    (args.output / "request.json").write_text(json.dumps({"body": body, "traceparent": traceparent}, indent=2) + "\n")
    result = request(args.server + "/ironflow.v1.IronflowService/Emit", body, {"traceparent": traceparent})
    assert len(result.get("runIds", [])) == 1, f"start exactly one fixture worker before emitting: {result}"
    run_id = result["runIds"][0]
    (args.output / "emit.json").write_text(json.dumps(result, indent=2) + "\n")
    deadline = time.monotonic() + args.timeout
    last_error = "no traces"
    while time.monotonic() < deadline:
        document = {"resourceSpans": []}
        try:
            run = request(args.server + "/ironflow.v1.IronflowService/GetRun", {"id": run_id})
            (args.output / "run.json").write_text(json.dumps(run, indent=2) + "\n")
            assert run.get("status") == "RUN_STATUS_COMPLETED", f"run not completed: {run.get('status')}"
            assert run.get("attempt") == 2, f"expected exactly one retry: {run.get('attempt')}"
            for service in (args.engine_service, args.worker_service):
                query = urllib.parse.urlencode({
                    "query.serviceName": service,
                    "query.startTimeMin": started.isoformat(),
                    "query.startTimeMax": (datetime.now(timezone.utc) + timedelta(seconds=5)).isoformat(),
                    "query.searchDepth": 1000,
                    "query.rawTraces": "true",
                })
                result = request(args.jaeger + "/api/v3/traces?" + query)["result"]
                document["resourceSpans"].extend(result.get("resourceSpans", []))
            (args.output / "traces.json").write_text(json.dumps(document, indent=2) + "\n")
            summary = verify(document, run_id, producer)
            print(json.dumps(summary, indent=2))
            (args.output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
            return
        except (AssertionError, urllib.error.URLError) as error:
            last_error = str(error)
        time.sleep(1)
    raise SystemExit(f"trace verification timed out: {last_error}; evidence: {args.output}")


if __name__ == "__main__":
    main()
