# Doc Processor — Browser Demo

Browser-driven UI for the `doc-processor` agent. Demonstrates `ironflow.agents.invoke()`, `ironflow.agents.subscribe()`, and `ironflow.agents.readMemory()` end-to-end against a live Ironflow server.

This is the YC pitch demo surface for Lane B-3 (issue #625).

## Prerequisites

- Ironflow server running locally: `./build/ironflow serve --dev`
- Doc-processor worker running: from `examples/agents/doc-processor-agent/`, run `pnpm dev`
- This example installed: `pnpm install` from this directory

## Run

```bash
pnpm dev
# open http://localhost:3001
```

Click **Run agent**. The page calls `ironflow.agents.invoke("doc-processor", {...})`, streams step events live, and on completion calls `ironflow.agents.readMemory("doc-processor-memory")` to render the agent's per-doc state.

## What it shows

```
  [User]                  [Browser SDK]                  [Ironflow]
  click ─▶ Run agent ─▶ agents.invoke ─▶ POST /Trigger
                       ─▶ subscribe(system.run.{runId}.>, replay:N)
                                              │
                                              ◀─── system.run.{runId}.created
                                              ◀─── system.run.{runId}.step.tool.ocr.created
                                              ◀─── system.run.{runId}.step.tool.classify.created
                                              ◀─── system.run.{runId}.step.tool.publish.created
                                              ◀─── system.run.{runId}.completed
                       resolve {runId, output}
  ◀─── render result
                       ─▶ agents.readMemory("doc-processor-memory")
                                              │
                                              ◀─── projection state
  ◀─── render memory table (per-doc status + category)
```

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_IRONFLOW_URL` | `http://localhost:9123` | Ironflow server URL |
| `NEXT_PUBLIC_AGENT_ID` | `doc-processor` | Agent function ID to invoke |

## Edge cases exercised

- **Double-click submit** — `idempotencyKey` derived per click prevents duplicate runs
- **Tab close mid-invoke** — `AbortController` triggers server-side `CancelRun` (B-3 D11)
- **Network flap** — `SubscriptionManager` reconnects with replay; completion still observed
- **Empty result** — UI renders `{}` cleanly without crashing

See `sdk/js/browser/src/agents/spec.md` for the full contract.
