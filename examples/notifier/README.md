# Notifier

A standalone TypeScript subscriber alerts on failed runs and projection errors using the public Node SDK. Rules, delivery identities, projection error state, and subscription cursors live in Ironflow KV. No engine changes or Slack credentials are required.

This is a module candidate under [Proposed ADR 0126](../../docs/adr/0126-ship-first-party-capabilities-as-modules-of-the-engine-binary.md), shipped as an example to test demand.

## Quick start

Use Node 24 and pnpm. Commands below use fish, from the repository root unless a directory is shown.

```fish
# Terminal 1. Keep its data directory across notifier restarts.
ironflow serve --dev

# Terminal 2. Build the linked SDK once, then run the subscriber.
pnpm install --frozen-lockfile
pnpm -C sdk/js build
cd examples/notifier
pnpm install --frozen-lockfile
pnpm start
# Wait for: Notifier ready (console delivery; bucket=example-notifier)

# Terminal 3, from examples/notifier. Produce a real failed run.
pnpm demo
```

The notifier prints `[alert] Run failed: react.notifier-demo ...`. The demo starts a temporary pull worker concurrently with its driver. It waits for the function to appear through the public API, then emits `notifier-demo.requested`, waits for its failed run, stops the worker, and awaits its polling lifetime before exiting. Registration and run checks are bounded; startup errors stop the demo. The SDK Connected log confirms registration, while the earlier starting/PID line only identifies the process. It leaves the failed run available in the dashboard at `http://localhost:9123`.

To use another engine URL, set it in every example terminal before starting:

```fish
set -gx IRONFLOW_SERVER_URL http://localhost:9123
# Required when the engine runs with authentication, omitted for --dev:
set -gx IRONFLOW_API_KEY ifkey_your_environment_key
# Optional for a selected environment:
set -gx IRONFLOW_ENV env_default
```

The SDK's KV requests use the API key's environment; the explicit `IRONFLOW_ENV` setting scopes subscriptions and workers. With auth enabled, use a key from that same environment with permission to subscribe to system topics and read/write KV; the demo additionally registers and reads functions (`functions:read` for its registration probe), polls jobs, emits events and reads runs. Do not put the key in a browser.

## Prove restart dedupe

1. Wait for `Notifier ready`, run `pnpm demo`, and note its run ID and the corresponding alert.
2. Stop only the notifier with Ctrl-C, keeping the engine and its data directory running.
3. Run `pnpm start` again with the same API key/environment and `NOTIFIER_BUCKET`. Wait for `Notifier ready`. The old failed run must not alert again.
4. Run `pnpm demo` again. The new run must alert once.

This proof does not depend on avoiding history. On first start each subscription requests retained history from sequence `0`. On subsequent starts it resumes after its persisted exact sequence. The SDK also uses sequence cursors on reconnect. Processing is serialized per subscription because SDK callbacks are not awaited. A delivery or KV failure retries the same frame before advancing its cursor. Duplicate failed-run frames use the same run ID, attempt and transition time as a second guard.

To explicitly replay retained history while keeping delivered identities, reset only the run cursor through the public SDK from this directory:

```fish
pnpm replay
```

Stop the notifier before resetting, then restart it. Previously delivered run alerts remain suppressed even when replayed. The projection subscription keeps its own cursor and is unaffected. In normal processing, an observed projection recovery followed by a later error is a new alert.

## Real vs. simulated

| Part | Behavior |
| --- | --- |
| Engine, failure, subscriptions, KV and restart state | Real local Ironflow |
| Default delivery | Console output, no third-party calls |
| Demo failure | Intentional `NonRetryableError`, no production work |
| Slack incoming webhook | Real when `SLACK_WEBHOOK_URL` is configured |

To deliver to Slack, create an incoming webhook and restart the notifier:

```fish
set -gx SLACK_WEBHOOK_URL https://hooks.slack.com/services/YOUR/WEBHOOK/SECRET
pnpm start
```

Treat the webhook URL as a secret. Delivery uses a bounded HTTP request and checks the status. HTTP failure leaves the alert retryable. Run only one notifier process per bucket. Two concurrent processes can send the same alert before either records delivery.

If delivery succeeds but its KV write fails, the running notifier remembers the delivery and retries the checkpoint without sending again. There is still a crash window between external delivery and writing its KV checkpoint. A kill in that window can resend an alert. This example provides persistent dedupe after a successful checkpoint, not exactly-once external delivery. History is limited by the engine's pub/sub retention. Failure frames already expired before startup cannot be recovered by this subscriber. Checkpoints and delivered-run identity keys have no expiry, so plan cleanup before using this as a long-lived production service.

## Topics and rules

The subscriptions are `system.run.>` and `system.projection_health.>`. The issue's sketch used `system.projection.{name}.health`; current projection health lives in its own namespace. The notifier reads health fields `name`, `status`, `error_message` and `last_event_seq`. An `error` status alerts once per ongoing error/cursor combination. An observed recovery clears that state. Run alerts select only the top-level `.failed` lifecycle frame, avoiding duplicate `.updated` and step failures.

The default bucket is `example-notifier`; set `NOTIFIER_BUCKET` to isolate a second demonstration. Its `rules` key is JSON `{ "runs": true, "projections": true }`. Change it through the public KV API, for example from this directory:

```fish
pnpm rules true false
```

Rules are read for each frame. Disabled alerts still advance the cursor; enabling a rule later does not send old suppressed alerts. Reset cursors only while stopped if you want a deliberate retained-history replay. Do not delete delivered identities unless you intend to resend.

## Checks

```fish
pnpm typecheck
pnpm test
```

Unit tests also exercise a worker whose start promise stays pending until stop, initial missing registration, and startup-error cleanup. Unit tests cover filtering, replay/restart state, exact uint64 sequences, projection recovery, delivery retry, and KV serialization/error handling. The restart walkthrough above exercises the actual engine separately. Slack delivery needs a real webhook and is not part of the offline checks.
