# Customer data removal verification

This app exercises the customer-removal story in
[`What does "delete" mean in an event-sourced system?`](../../docs/blog/posts/2026-10-05-what-does-delete-mean-in-an-event-sourced-system.md).
The Python standard-library push handler returns a deterministic account lookup
as a durable step and a run result. Ironflow persists both. No external account
service is called.

## Run the app and assertions

From the repository root, with Go and Python 3 installed:

```sh
go test ./tests/integration -run '^TestDeletionBlogCustomerApp$' -count=1 -v
```

The integration runner starts the Python app and a real Ironflow HTTP server,
with an isolated SQLite database and embedded JetStream for each scenario. It
uses a bootstrap admin key internally and cleans up the processes and storage.
It does not use your running server or delete your data.

The runner performs these steps:

1. Register the customer function with recording enabled, a deployment record,
   and a managed customer-directory projection.
2. Append `customer.registered` to `customer-42` with a name and email.
3. Wait for the function to complete. Check the email in run input, run output,
   step output, and recorded audit payloads.
4. Poll the projection's actual event delivery and save its derived state.
   Create an entity snapshot.
5. Exercise each removal strategy in a fresh environment:
   - Redact the event, then the run, then the step. Check each independent copy,
     the preserved event sequence and entity version, removed snapshot, and
     idempotent event redaction.
   - Delete the run. Check that its steps disappear, its event and audit
     payloads survive, its child run survives with no parent link, and the
     registered deployment record survives.
   - Tombstone the stream. Check that history remains and later appends fail.
     Purge twice; check that only the tombstone remains and its version stays
     fixed, while the terminal run cascades away. Check that the projection's
     event-name filter excludes the unregistered tombstone.
6. For each strategy, check that the customer-directory state and the
   already-published JetStream payload still contain the original email.

The handler can also run on its own with `python3 examples/deletion-redaction/app.py`.
It prints its loopback URL and accepts Ironflow's push-protocol requests. The
integration command performs registration and event delivery automatically.

## Verify the remaining runtime claims

The app covers the customer story. The existing tests below cover older records,
controlled clocks, non-terminal guards, concurrent writers, and failing blob
backends. Docker enables the real PostgreSQL cases.

```sh
TEST_POSTGRES=1 go test ./internal/store -run 'Redact|Redaction|Retention|DeleteTerminalRuns|DeleteUnreferencedEvents|DeleteEntityStreamData|DeleteTombstonedEntity|Purge' -count=1
go test ./internal/server/connect ./internal/projection ./internal/nats -run 'Redact|DeleteRun|DeleteStream|Purge|Rebuild_.*(Horizon|Retention|Entity|Pruned|Environment)|StreamConfigs' -count=1
go test ./internal/server ./internal/audit/pruner -run 'Retention|Prun' -count=1
go test ./internal/engine -run 'Redact|Redacted' -count=1
go test -tags integration_s3 ./internal/store -run '^TestBlobRedactionSweepS3$' -count=1
```

| Blog claim | Executable evidence |
| --- | --- |
| Payload copies need separate removal operations | `TestDeletionBlogCustomerApp`, store and ConnectRPC redaction tests |
| Redaction keeps event position and entity version | App scenario, `TestRedactEvent_ReplacesDataAndIsIdempotent` |
| Snapshots disappear on entity-event redaction or stream deletion | App scenario, `TestSQLiteStore_RedactEvent_DropsEntityStreamSnapshots`, PostgreSQL equivalent |
| Run deletion keeps events, deployments, audit payloads and child runs | App deletion scenario |
| Tombstone remains after purge; active runs block purge; retry works | App purge scenario, `TestSQLiteStore_PurgeRefusesActiveRuns`, ConnectRPC stream deletion tests |
| Retention skips pinned events and live entity streams | SQLite and PostgreSQL retention suites, server retention jobs |
| Retention defaults off, has a seven-day floor, and runs nightly | Server retention configuration tests, audit pruner tests; startup reads the windows in `internal/server/server.go` |
| Rebuild and dry run refuse an older replay window | `internal/projection/retention_horizon_test.go`, including full, partial, entity-only, young-environment, and fully-pruned-filter cases |
| Run redaction does not authorize step artifact cleanup | Blob redaction acceptance and contract tests on SQLite and PostgreSQL |
| Late uploads and failed sweeps get revisited | `TestBlobRedactionAcceptance`, `TestBlobRedactionRecovery`, `TestBlobRedactionCleaner`, `TestBlobOverflowRedactionCoordination` |
| Protected payloads survive stale lifecycle writes | Blob redaction writer tests and engine redaction tests |
| Published plaintext survives database redaction/deletion | App JetStream assertions; `TestStreamConfigs` verifies the transport windows |
| Redaction helpers and upcasters preserve placeholders | Go, TypeScript and Python SDK upcaster tests |

SDK helper checks, after installing the repository's dependencies:

```sh
go -C sdk/go/ironflow test ./... -run 'Redact|Upcast' -count=1
pnpm --filter @ironflow/core test
sdk/python/.venv/bin/python -m pytest sdk/python/tests -k 'redact or upcast' -q
```

## Evidence limits

The default EVENTS and PUBSUB `MaxAge` is seven days. The app checks that the
published copy survives immediately; it does not wait seven days. The pruner
tests advance a controlled clock instead of waiting weeks.

The S3 sweep test uses an S3-compatible in-memory server. Blob race and recovery
tests inject failures and late uploads; they do not claim a removal deadline or
an atomic database/object-store transaction.

The archive statement is a storage-provider constraint, supported by
[Amazon S3 Object Lock documentation](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html).
No locked AWS bucket is provisioned here. Exports to other systems remain
application-owned. Neither this app nor the blog asserts regulatory compliance.

The tests support two documentation corrections: registered deployment records
survive deletion, and run/step blob redaction now has permanent retry markers
instead of only a request-time best-effort sweep. The app uses legacy execution
routing; registering a deployment record alone does not prove that a run used
that executable. The blog and linked API reference use the verified behavior.
