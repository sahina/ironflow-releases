# doc-processor-agent

Durable OCR → classify → publish pipeline. Demonstrates Ironflow's crash-resume guarantee: kill the worker mid-pipeline, restart it, the agent picks up from the last completed step.

This is the runnable companion to the [Survive a Crash](../../../docs/tutorials/agent-survives-crash.md) tutorial and the example behind `make demo-agent-crash-resume`.

## Pipeline

```text
                 doc.received                    doc.processed
                       │                                ▲
                       ▼                                │
             ┌─────────────────────────────────────────────┐
             │  doc-processor agent                        │
             │                                             │
             │   tool(ocr)  ──► tool(classify)  ──►        │
             │      ▲              ▲              tool(    │
             │      │              │              publish) │
             │      │              │                       │
             │   3s sleep       200ms             memory.  │
             │   (kill window)                    append() │
             └─────────────────────────────────────────────┘
```

Every box is a memoized step. Crash inside the kill window, restart, and OCR re-runs from scratch — it never completed, so there is no cached row — then `classify` and `publish` run fresh against its output. Crash *after* OCR and it replays from cache instead.

## Quick start

```bash
# 1. Server (separate terminal)
ironflow serve --dev

# 2. Build the SDK once
pnpm -C ../../../sdk/js build

# 3. Install + start the worker
pnpm install
pnpm dev

# 4. Trigger a doc (separate terminal)
pnpm trigger doc-1 https://example.com/invoice.png

# 5. Verify state
pnpm verify doc-1
```

## Crash-resume demo

The literal script behind `make demo-agent-crash-resume`:

```bash
./scripts/demo-crash-resume.sh
```

What it does:

1. Starts a throwaway server (`--dev`) on a random HTTP port (override with `IRONFLOW_PORT`), an ephemeral NATS port and its own SQLite database
2. Starts the worker (`pnpm start`)
3. Emits `doc.received`; the OCR step sleeps 3 seconds (`DOC_PROCESSOR_OCR_MS`)
4. After 1.5 seconds — **mid-OCR** — sends `kill -9` to the worker
5. Restarts the worker
6. Polls the `doc-processor-memory` projection until `status="published"` shows up for the docId
7. Tears down

Exit 0 ⇒ the agent recovered from the crash. Budget 2.5 to 3.5 minutes: a killed worker's run only resumes after its concurrency lease expires (2m35s and 2m30s in two audit runs; see [Crash recovery](../../../docs/explanation/crash-recovery.md)). Because the kill lands mid-OCR, OCR runs again on the new worker; the worker logs show `[ocr]` once per worker. To see a finished step replayed from cache instead, kill after OCR (`DEMO_RECORD=1` kills mid-classify): the second worker logs no `[ocr]` line.

## Files

- `src/agent.ts` — `agent()` definition with `tools` and `memory` config
- `src/events.ts` — event names shared between the scripts and the agent
- `src/tools.ts` — `defineTool()` for ocr, classify, publish
- `src/memory.ts` — `createProjection()` deriving doc state
- `src/worker.ts` — pull-mode worker entrypoint
- `scripts/trigger.ts` — emit a `doc.received` event
- `scripts/verify.ts` — poll the projection until a docId is published
- `scripts/demo-crash-resume.sh` — the full kill -9 demo
- `scripts/record-demo.sh` — narrative wrapper around the demo, tuned for asciinema
- `web/` — browser UI for the same agent ([README](./web/README.md))

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `IRONFLOW_SERVER_URL` | `http://localhost:9123` | Server endpoint for workers, memory, and scripts |
| `IRONFLOW_API_KEY` | unset | API key when server is not in `--dev` mode |
| `DOC_PROCESSOR_OCR_MS` | `3000` | OCR sleep — shorten in tests, extend for filming |
| `DOC_PROCESSOR_CLASSIFY_MS` | `200` | Classify sleep — `DEMO_RECORD` sets 5000 so the kill lands after OCR finished |
| `DEMO_RECORD` | unset | `demo-crash-resume.sh` screen-recording mode: 20s pause before the event, kill mid-classify, server kept up until Ctrl-C |
| `IRONFLOW_BIN` | `build/ironflow` in the repo root | Binary that `demo-crash-resume.sh` starts. Build it with `make embed build` |
| `IRONFLOW_PORT` | random port from 30000 to 59999 | HTTP port of the demo's throwaway server |
| `DEMO_DOC_ID` | `demo-crash-<epoch seconds>` | docId the demo emits and verifies |
| `DEMO_IMAGE_URL` | `https://example.com/invoice.png` | imageUrl the demo emits |
| `DEMO_KILL_AFTER_MS` | `1500`; `5500` with `DEMO_RECORD` | Delay between the emit and `kill -9` |
| `VERIFY_TIMEOUT_MS` | `210000` | `verify.ts` polling deadline. Crash-resume is gated on concurrency-lease expiry and takes 90s-3min; 210s leaves headroom. See the [tutorial](../../../docs/tutorials/agent-survives-crash.md) callout |

## Layering

This example is intentionally minimal:

- No real OCR / LLM provider — see `src/tools.ts` for swap-in points
- No human approval — see `examples/agents/code-review-agent/` for the `approve()` story
- No external HTTP — pull-mode worker only

The crash-resume guarantee is the **only** thing this example exists to prove. Other examples layer LLM, approve, and webhook flows on top.
