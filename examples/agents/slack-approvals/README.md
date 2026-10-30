# Slack approvals

A deterministic agent prepares a draft and pauses at a durable `approve()` gate. A separate inbox lists this example's waiting runs, reads the draft from their steps, and provides Approve and Reject buttons. By default those buttons run locally. Slack is optional.

This is a module candidate under [Proposed ADR 0126](../../../docs/adr/0126-ship-first-party-capabilities-as-modules-of-the-engine-binary.md), shipped as an example to test demand.

```text
slack-demo.requested -> prepare-draft -> approve(agent.approve.slack-demo)
                                                |
          local page OR signed Slack button -> emit decision with runId
                                                |
                                      same run completes
```

The SDK caller chooses the gate event name. `agent.approve.slack-demo` is this example's explicit constant, not an engine-defined approval API. The parked step's `input` is the draft itself, rather than an `input.payload` wrapper.

## Quick start

Use Node 24 and pnpm. Commands use fish. Start from the repository root.

```fish
# Terminal 1
ironflow serve --dev

# Terminal 2. Build the linked SDK once, then run the pull worker.
pnpm install --frozen-lockfile
pnpm -C sdk/js build
cd examples/agents/slack-approvals
pnpm install --frozen-lockfile
pnpm worker
# The starting line prints the actual worker PID.
# Wait for the SDK Connected log before triggering.

# Terminal 3, from examples/agents/slack-approvals
pnpm start
# Local inbox ready: http://127.0.0.1:9138

# Terminal 4, from examples/agents/slack-approvals
pnpm trigger "Deploy the demo release"
# Note the printed runId.
```

Open `http://127.0.0.1:9138`, find that run ID, and click Approve or Reject. The page refreshes every three seconds. Inspect the same run at `http://localhost:9123`: it completes with `approved: true` and `action: "simulated action accepted"`, or `approved: false` and `action: "skipped"`. Neither path deploys anything. A gate expires after 24 hours and the engine then fails the run.

For a different engine or an authenticated server, set these in each worker, inbox, and trigger terminal:

```fish
set -gx IRONFLOW_SERVER_URL http://localhost:9123
# Omit for --dev. Use an environment API key with the required permissions.
set -gx IRONFLOW_API_KEY ifkey_your_environment_key
# Optional, when explicitly selecting an environment:
set -gx IRONFLOW_ENV env_default
```

The key must allow function registration/job polling, run and step reads, event emission, and event reads through `events:subscribe`. The inbox reads back the stored decision before reporting success. Keep this key in the server process. The local browser never receives it. Change `APPROVAL_PORT` if `9138` is occupied, and open the printed URL. The worker prints its PID before entering `start()`, which runs until stopped; its starting line does not claim registration is complete. Wait for the SDK Connected log before triggering. Use `127.0.0.1`, because local Host and Origin checks deliberately require it.

## Prove kill/restart and rejection

1. Trigger a new run and wait until its button appears. Record its run ID.
2. Kill the worker PID from the starting line printed by `pnpm worker` with `kill -9 WORKER_PID`. Keep the engine and inbox running.
3. Restart `pnpm worker`. The same waiting run stays in the inbox; no new trigger is needed.
4. Click Approve for that run. Confirm that exact run ID completes with `approved: true` in the dashboard.
5. Trigger another run, click Reject and confirm `approved: false` with `action: "skipped"`.

The wait is stored by Ironflow and holds no worker slot. Restarting the inbox also reloads waiting gates from the public run/step APIs. Restarting the engine requires preserving its data directory.

## Real vs. simulated

| Part | Behavior |
| --- | --- |
| Agent, durable draft step, gate, run inspection and decision event | Real Ironflow |
| Reasoning/model | Deterministic draft; no model call or key |
| Default buttons | Local HTTP inbox on loopback only |
| Approved action | Simulated result, no deployment or vendor side effect |
| Slack messages and interactions | Real when all Slack settings are present |

Only `slack-approvals-agent` runs currently waiting on this example's exact gate event and step are eligible. The handler re-reads the run and step before emitting `{runId, approved, approver}` to that fixed event. It never trusts a caller-supplied event name. Local decisions require POST JSON, a matching Origin and Host, and a random session token. Slack mode disables local UI and decision access.

Slack identity is informational only. All Ironflow calls use the application's API key, so there is no per-person Ironflow authorization or audit identity for the person who clicked. The `approver` payload records the claimed Slack user for display, while the authenticated emitter remains the application. Forwarded identity for a module version is discussed in ADR 0126.

## Use real Slack

1. Create a Slack app, grant bot scope `chat:write`, install it into your workspace, and invite the bot to the target channel.
2. Configure all three settings in the inbox terminal. Partial configuration fails startup.

```fish
set -gx SLACK_BOT_TOKEN xoxb-your-bot-token
set -gx SLACK_CHANNEL_ID C0123456789
set -gx SLACK_SIGNING_SECRET your-signing-secret
pnpm start
```

3. Expose the callback listener through an HTTPS endpoint you control, forwarding to port `9138`. Slack mode listens on `0.0.0.0`; it exposes only `/slack/actions` and accepts no local simulation decisions.
4. In the Slack app's Interactivity & Shortcuts settings, enable interactivity and set Request URL to `https://YOUR_HOST/slack/actions`.
5. Run `pnpm trigger`. The inbox posts the draft with Approve and Reject buttons to the configured channel. Click one and inspect the printed run ID in Ironflow.

The adapter calls [`chat.postMessage`](https://docs.slack.dev/reference/methods/chat.postMessage/) with a bot token and Block Kit buttons. It verifies [Slack request signatures](https://docs.slack.dev/authentication/verifying-requests-from-slack/) against the raw form body using HMAC SHA256 and a timing-safe comparison. Timestamps outside five minutes are rejected, as are bodies over 64 KiB, wrong channels, malformed actions and decisions.

[Slack interactions require an acknowledgment within three seconds](https://docs.slack.dev/interactivity/handling-user-interaction/). The handler acknowledges after Ironflow accepts the event, with SDK retries disabled and a 500 ms timeout per call. Read/emit failure returns an error so a lost decision is not acknowledged as successful. Retry or refresh after a timeout. Slow remote engines may need a durable inbox instead of this synchronous example.

Run one inbox process per environment. An in-flight decision blocks competing clicks, and event emission has a stable per-gate idempotency key for retries. The inbox reads the returned event from Ironflow and reports success only when its stored choice matches the click. An opposite choice returns a conflict, including after a lost emit response or an inbox restart. Event-read failure returns an error rather than guessing the stored choice. The engine still validates the pending correlation. This is not a distributed, transactional first-click-wins approval service. Duplicate or stale clicks can report an error after the gate has moved on. Slack post IDs are remembered in process memory only; restarting the inbox can repost an unanswered gate, and a send response lost in transit can also duplicate a message. Both buttons target the same durable gate. The same event idempotency key prevents intentionally changing an already submitted decision within the engine's dedupe window.

## Checks

```fish
pnpm typecheck
pnpm test
```

Tests cover direct step input, gate/function/state checks, approve and reject routing, concurrent and failed sends, signature tampering and replay bounds, local CSRF boundaries, Slack/local isolation, and body limits through real local HTTP requests. The manual walkthrough above checks actual durable execution. Tests sign synthetic Slack payloads locally; they do not contact Slack.
