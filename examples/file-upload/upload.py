"""Uploads two files (direct and via a signed URL), then reads the reports back."""

import json
import os
import time
import urllib.request

from ironflow import IronflowClient, IronflowError

client = IronflowClient(
    os.environ.get("IRONFLOW_SERVER_URL", "http://localhost:9123"),
    api_key=os.environ.get("IRONFLOW_API_KEY"),
)


def ensure_bucket(**cfg):
    try:
        client.files_buckets(body=cfg)
    except IronflowError as e:
        if e.status_code != 409:  # already exists
            raise


def wait_for_report(path, timeout=20.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        try:
            with client.files_get_buckets_objects("reports", f"{path}.json") as resp:
                return json.loads(resp.read())
        except IronflowError as e:
            if e.status_code != 404:
                raise
            time.sleep(0.5)
    raise TimeoutError(f"no report for {path}; is worker.py running?")


ensure_bucket(name="inbox", emitEvents=True, allowSignedUrls=True, maxObjectBytes=1024 * 1024)
ensure_bucket(name="reports", allowSignedUrls=True)

# 1. Direct upload with the API key.
client.files_update_buckets_objects("inbox", "notes/direct.txt", b"one\ntwo\nthree\n", content_type="text/plain")

# 2. Signed upload: the token in the URL is the only credential. Hand this URL to a
#    browser or another service that has no API key.
signed = client.files_buckets_signed_urls_upload(
    "inbox", body={"path": "notes/signed.txt", "contentType": "text/plain", "maxBytes": 1024}
)
req = urllib.request.Request(
    signed["url"], data=b"uploaded\nwith a signed url\n", method="PUT", headers={"Content-Type": "text/plain"}
)
urllib.request.urlopen(req, timeout=10).close()

for path in ("notes/direct.txt", "notes/signed.txt"):
    print(path, "->", wait_for_report(path))

# 3. Signed download: share a report without sharing the API key.
link = client.files_buckets_signed_urls_download("reports", body={"path": "notes/direct.txt.json", "ttlSeconds": 60})
with urllib.request.urlopen(link["url"], timeout=10) as resp:
    print("signed download:", resp.read().decode())
