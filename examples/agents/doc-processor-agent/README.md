# doc-processor-agent

Durable OCR → classify → publish pipeline. Demonstrates Ironflow's crash-resume guarantee: kill the worker mid-pipeline, restart it, the agent picks up from the last completed step.

This is the runnable companion to the [Survive a Crash](../../../docs/tutorials/agent-survives-crash.md) tutorial and the example behind `make demo-agent-crash-resume`.

## Pipeline

```
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

Every box is a memoized step. Crash inside the kill window, restart, and only the OCR call re-runs — `classify` and `publish` run fresh against the cached OCR output.

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
pnpm trigger -- doc-1 https://example.com/invoice.png

# 5. Verify state
pnpm verify -- doc-1
```

## Crash-resume demo

The literal script behind `make demo-agent-crash-resume`:

```bash
./scripts/demo-crash-resume.sh
```

What it does:

1. Starts the worker (`pnpm dev`)
2. Emits `doc.received` with a slow image URL (3-second OCR sleep)
3. After 1.5 seconds — **mid-OCR** — sends `kill -9` to the worker
4. Restarts the worker
5. Polls the `doc-processor-memory` projection until `status="published"` shows up for the docId
6. Tears down

Exit 0 ⇒ the agent recovered from the crash.

## Files

- `src/agent.ts` — `agent()` definition with `tools` and `memory` config
- `src/tools.ts` — `defineTool()` for ocr, classify, publish
- `src/memory.ts` — `createProjection()` deriving doc state
- `src/worker.ts` — pull-mode worker entrypoint
- `scripts/trigger.ts` — emit a `doc.received` event
- `scripts/verify.ts` — poll the projection until a docId is published
- `scripts/demo-crash-resume.sh` — the full kill -9 demo

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `IRONFLOW_URL` | `http://localhost:9123` | Server endpoint (memory backend + scripts) |
| `IRONFLOW_API_KEY` | unset | API key when server is not in `--dev` mode |
| `DOC_PROCESSOR_OCR_MS` | `3000` | OCR sleep — shorten in tests, extend for filming |
| `VERIFY_TIMEOUT_MS` | `90000` | `verify.ts` polling deadline (default 90s leaves headroom over NATS AckWait redelivery; see [tutorial](../../../docs/tutorials/agent-survives-crash.md) callout) |

## Layering

This example is intentionally minimal:

- No real OCR / LLM provider — see `src/tools.ts` for swap-in points
- No human approval — see `examples/agents/code-review-agent/` for the `approve()` story
- No external HTTP — pull-mode worker only

The crash-resume guarantee is the **only** thing this example exists to prove. Other examples layer LLM, approve, and webhook flows on top.
