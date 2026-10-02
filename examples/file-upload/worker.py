"""Reacts to every file written to the `inbox` bucket.

For each upload it reads the file, counts bytes and lines, and writes a JSON
report to the `reports` bucket. `reports` has emitEvents off, so the report
write cannot trigger this function again.
"""

import hashlib
import json
import os

from ironflow import IronflowClient
from ironflow.worker import Worker, function

client = IronflowClient(
    os.environ.get("IRONFLOW_SERVER_URL", "http://localhost:9123"),
    api_key=os.environ.get("IRONFLOW_API_KEY"),
)


@function(
    id="process-upload",
    triggers=[{"event": "ironflow.file.created", "expression": "data.bucket == 'inbox'"}],
)
async def process_upload(ctx):
    bucket, path, etag = (ctx.event.data[k] for k in ("bucket", "path", "etag"))

    def analyze():
        # if_match pins the version that caused the event.
        with client.files_get_buckets_objects(bucket, path, if_match=etag) as resp:
            body = resp.read()
        return {
            "path": path,
            "bytes": len(body),
            "lines": body.count(b"\n"),
            "sha256": hashlib.sha256(body).hexdigest(),
        }

    report = await ctx.step.run("analyze", analyze)

    # Step bodies must be idempotent; overwriting the same report path is.
    await ctx.step.run(
        "write-report",
        lambda: client.files_update_buckets_objects(
            "reports", f"{path}.json", json.dumps(report).encode(), content_type="application/json"
        ),
    )
    return report


if __name__ == "__main__":
    Worker(functions=[process_upload]).run()
