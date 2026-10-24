# Doc Processor — Browser Demo

Browser-driven UI for the `doc-processor` agent. Demonstrates `ironflow.agents.invoke()`, `ironflow.agents.subscribe()`, and `ironflow.agents.readMemory()` end-to-end against a live Ironflow server.

This is the YC pitch demo surface for Lane B-3 (issue #625).

## Prerequisites

- Ironflow server running locally: built with `make embed build` from the repo root (a plain `make build` produces a binary whose `serve` refuses to start), then `./build/ironflow serve --dev`
- Doc-processor worker running: from `examples/agents/doc-processor-agent/`, run `pnpm dev`
- This example installed: `pnpm install` from this directory
- Set `NEXT_PUBLIC_IRONFLOW_SERVER_URL` when the engine is not on `:9123` (Next inlines it at dev-server start)

## Run

```bash
pnpm dev
# open http://localhost:3001
```

Click **Run agent**. The page calls `ironflow.agents.invoke("doc-processor", {...})` (one `InvokeFunctionSync` request that returns when the run settles, about 3 s), then calls `ironflow.agents.readMemory("doc-processor-memory")` to render the agent's per-doc state.

The **Steps** panel replays step events after the run completes. `invoke()` returns the runId with the terminal result, so steps are not shown live during execution. The page then calls `agents.subscribe(runId)` with the SDK's default replay budget of 1000 events. Awaiting `subscribe()` does not wait for replay delivery, so the page closes the subscription when the replay delivers the run's terminal event (`completed`, `failed` or `cancelled`). A run that fails, or that the server cancels, replays its steps too. The page's own **Cancel** button aborts the request before a runId comes back, so it shows no steps.

## What it shows

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 210" width="700" role="img" aria-label="Run agent calls agents.invoke, then renders the result, reads memory, and subscribes to replayed steps until the terminal event, the next run, or unmount" font-family="ui-monospace, monospace" font-size="13" fill="currentColor">
  <rect x="10" y="10" width="110" height="30" rx="6" fill="none" stroke="currentColor"/>
  <text x="65" y="30" text-anchor="middle">Run agent</text>
  <line x1="120" y1="25" x2="160" y2="25" stroke="currentColor"/>
  <rect x="160" y="10" width="430" height="30" rx="6" fill="none" stroke="#3b82f6"/>
  <text x="375" y="30" text-anchor="middle">agents.invoke → InvokeFunctionSync → {runId, output}</text>
  <line x1="180" y1="40" x2="180" y2="160" stroke="currentColor"/>
  <line x1="180" y1="70" x2="200" y2="70" stroke="currentColor"/>
  <text x="208" y="74">render result</text>
  <line x1="180" y1="110" x2="200" y2="110" stroke="currentColor"/>
  <text x="208" y="114">agents.readMemory → render memory table</text>
  <line x1="180" y1="160" x2="200" y2="160" stroke="currentColor"/>
  <text x="208" y="164">agents.subscribe(runId, replay:1000) → render replayed steps</text>
  <line x1="220" y1="170" x2="220" y2="190" stroke="currentColor"/>
  <line x1="220" y1="190" x2="240" y2="190" stroke="currentColor"/>
  <text x="248" y="194" fill="#10b981">terminal event, next run, or unmount → unsubscribe</text>
</svg>

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_IRONFLOW_SERVER_URL` | `http://localhost:9123` | Ironflow server URL |
| `NEXT_PUBLIC_AGENT_ID` | `doc-processor` | Agent function ID to invoke |

## Edge cases exercised

- **Double-click submit** — the button is disabled while a run is in flight, and `run()` returns early on a second click. Each click gets its own `idempotencyKey`, so the server can drop a repeat of the same request. The key does not dedupe two clicks
- **Tab close mid-invoke** — `AbortController` aborts the HTTP request; the server reads the abandoned caller and cancels the run itself (ADR 0067), no client-side `cancelRun`
- **Network flap** — `SubscriptionManager` reconnects with replay
- **Empty result** — UI renders `{}` cleanly without crashing

Run `pnpm test` in `web/` to check delayed replay, terminal-event close, failed-run replay, a `beforeunload` that does not unload, subscription replacement, and unmount cleanup.

See `sdk/js/browser/src/agents/spec.md` for the full contract.
