# code-review-agent

Durable PR review agent. Fetches a diff, runs it through an LLM, waits for human approval, posts a comment. Crash-resilient at every step.

```text
   pr.opened ──► fetch-diff ──► llm.turn   ──► approve("code-review.post-review.approved") ──► post-comment
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

## Real vs. simulated

Everything external is simulated, so the example runs offline and needs no keys:

- `fetch-diff` returns a hard-coded diff after a 500ms sleep. It never calls GitHub.
- `llm.complete()` wraps `reviewWith()` in `src/llm.ts`, a keyword check on that diff (300ms sleep). No model is called.
- `post-comment` only logs to the worker console and returns a fake `commentId`. Nothing is posted anywhere, and no `GITHUB_TOKEN` is read.

What is real: the Ironflow run, the durable steps, the `approve()` pause, and the crash-resume behavior.

## Quick start

```bash
# Server
ironflow serve --dev

# SDK build (once)
pnpm -C ../../../sdk/js build

# Install + run worker
# Set IRONFLOW_SERVER_URL for the worker and scripts if the server runs elsewhere.
pnpm install
pnpm dev

# Trigger a review (separate terminal)
pnpm trigger octocat/hello 42

# `pnpm trigger` prints the runId (and the exact approve command). Approve it:
pnpm run approve <runId>

# Or reject: the run completes with { posted: false, reason: "looks unsafe" }
pnpm run approve <runId> false "looks unsafe"
```

Approve only after the run is waiting (about a second after `pnpm trigger`, once `fetch-diff` and the LLM step finish; see it with `ironflow run get <runId>`). An approval event sent before the gate is reached is dropped, and the run then waits the full 24h. Send it again once the run shows `waiting`. An approval for an unknown or already finished run is accepted and ignored.

If nobody answers within the 24h TTL, the run fails with `waitForEvent timed out` and nothing is posted. A late approval does not revive it.

## Crash-resilience callout

`approve("code-review.post-review.approved", { ttl: "24h" })` calls `step.waitForEvent` under the hood. You pick the event name; `pnpm run approve` emits it with `{ runId, approved }`. The pause is **durable**:

```bash
# Trigger and watch the worker pause at the approval gate
pnpm trigger octocat/hello 42

# Kill the worker. The run stays paused on the server.
kill -9 $(pgrep -f "tsx.*worker.ts")

# Wait however long you want — minutes, hours, days.
sleep 120

# Restart. The agent picks up exactly where it stopped:
# fetch-diff is replayed from cache, llm output is replayed
# from cache, the approve gate keeps waiting for the event.
pnpm dev

# Approve it; the worker resumes, posts the comment.
pnpm run approve <runId>
```

This is the YC pitch in 30 seconds: **runs that span hours of human-time without burning a worker slot or losing context on restart.**

## Layering vs. doc-processor-agent

| Pattern                 | doc-processor | code-review               |
| ----------------------- | ------------- | ------------------------- |
| `tool()`                | ✓             | ✓                         |
| `memory()` + projection | ✓             | —                         |
| `llm()`                 | —             | ✓                         |
| `approve()`             | —             | ✓                         |
| Slow-step kill window   | OCR (3s)      | LLM call (300ms) — short  |
| Pause window            | none          | up to 24h via `approve()` |

Pair both examples to see the full primitive surface.

## Swap the simulated LLM

Edit `src/llm.ts`. The reference Anthropic implementation is in the comments — it returns the normalized `LLMCompleteResult` shape that `llm.complete()` expects. Run `pnpm add @anthropic-ai/sdk` (the example does not depend on it) and set `ANTHROPIC_API_KEY`, and you're live. The reference code has not been run against the live API.

Delivery of `post-comment` is at-least-once: a completed step is never re-run, but a crash after the real side effect and before the step is recorded would repeat it. Pass an idempotency key to the real GitHub call if that matters.

## Files

- `src/agent.ts` — agent definition wiring tool + llm + approve
- `src/events.ts` — event names shared between the trigger script and the agent
- `src/llm.ts` — LLM call closure (sub for real provider)
- `src/tools.ts` — fetch-diff, post-comment
- `src/worker.ts` — pull-mode worker entrypoint
- `scripts/trigger.ts` — emit a pr.opened event
- `scripts/approve.ts` — emit the code-review.post-review.approved event
