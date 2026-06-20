# code-review-agent

Durable PR review agent. Fetches a diff, runs it through an LLM, waits for human approval, posts a comment. Crash-resilient at every step.

```text
   pr.opened ──► fetch-diff ──► llm.review ──► approve("post-review") ──► post-comment
                     │              │                 │                       │
                     │              │                 │                       │
                  step.run       step.run        step.waitForEvent         step.run
                  memoized       memoized          (24h TTL)                memoized
                                                       │
                                              run can sleep here for
                                              hours/days; restart-safe;
                                              consumes no worker slot
                                              while waiting
```

## What this proves

- `tool()` wraps step.run with Zod validation + 60s timeout default
- `llm.complete()` memoizes the assistant response so a crash mid-LLM doesn't re-bill
- `approve()` is durable — kill -9 the worker, the run stays paused at the gate, restart and it keeps waiting
- Replays inside the same run are cheap; the LLM call is paid for once

## Quick start

```bash
# Server
ironflow serve --dev

# SDK build (once)
pnpm -C ../../../sdk/js build

# Install + run worker
pnpm install
pnpm dev

# Trigger a review (separate terminal)
pnpm trigger -- octocat/hello 42

# Worker logs print the runId. Approve it:
pnpm approve -- <runId>

# Or reject:
pnpm approve -- <runId> false "looks unsafe"
```

## Crash-resilience callout

`approve("post-review", { ttl: "24h" })` calls `step.waitForEvent` under the hood. The pause is **durable**:

```bash
# Trigger and watch the worker pause at the approval gate
pnpm trigger -- octocat/hello 42

# Kill the worker. The run stays paused on the server.
kill -9 $(pgrep -f "tsx.*worker.ts")

# Wait however long you want — minutes, hours, days.
sleep 120

# Restart. The agent picks up exactly where it stopped:
# fetch-diff is replayed from cache, llm output is replayed
# from cache, the approve gate keeps waiting for the event.
pnpm dev

# Approve it; the worker resumes, posts the comment.
pnpm approve -- <runId>
```

This is the YC pitch in 30 seconds: **runs that span hours of human-time without burning a worker slot or losing context on restart.**

## Layering vs. doc-processor-agent

| Pattern                 | doc-processor | code-review               |
| ----------------------- | ------------- | ------------------------- |
| `tool()`                | ✅            | ✅                        |
| `memory()` + projection | ✅            | —                         |
| `llm()`                 | —             | ✅                        |
| `approve()`             | —             | ✅                        |
| Slow-step kill window   | OCR (3s)      | LLM call (300ms) — short  |
| Pause window            | none          | up to 24h via `approve()` |

Pair both examples to see the full primitive surface.

## Swap the simulated LLM

Edit `src/llm.ts`. The reference Anthropic implementation is in the comments — it returns the normalized `LLMCompleteResult` shape that `llm.complete()` expects. Set `ANTHROPIC_API_KEY` and you're live.

## Files

- `src/agent.ts` — agent definition wiring tool + llm + approve
- `src/llm.ts` — LLM call closure (sub for real provider)
- `src/tools.ts` — fetch-diff, post-comment
- `src/worker.ts` — pull-mode worker entrypoint
- `scripts/trigger.ts` — emit a pr.opened event
- `scripts/approve.ts` — emit the agent.approve.post-review event
