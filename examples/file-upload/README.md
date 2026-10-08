# File upload (Python)

File storage with the Python SDK: create buckets, upload directly and through a signed URL, react to `ironflow.file.created` in a durable worker, and share a file with a signed download URL.

- `worker.py` runs `process-upload` on every file written to the `inbox` bucket. It reads the file, counts bytes and lines, and writes a JSON report to the `reports` bucket.
- `upload.py` creates both buckets, uploads two files (API key and signed URL), waits for the reports, and fetches one through a signed download URL.

`reports` has `emitEvents` off, so writing a report cannot trigger the function again.

## Run

```fish
ironflow serve --dev
```

In a second terminal:

```fish
pip install ironflow-py
python worker.py
```

In a third terminal:

```fish
python upload.py
```

Set `IRONFLOW_SERVER_URL` and `IRONFLOW_API_KEY` if the server is not `http://localhost:9123` in dev mode.

Run `upload.py` a second time and the paths already exist, so Ironflow emits `ironflow.file.updated`, not `created`. The worker does not run and the old reports stay. Use new paths, or add `ironflow.file.updated` as a second trigger.

See the [file storage guide](../../docs/how-to-guides/storage/files.mdx).
