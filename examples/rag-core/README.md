# rag-core — RAG series part 1

Ask questions of your own markdown docs. One Ironflow binary, one SQLite file,
no Docker.

This is part 1 of the [RAG guide series](../../docs/tutorials/rag-series.mdx).
It teaches the smallest complete pipeline: ingest → chunk → embed → store →
retrieve → answer, with the vector index built as a **projection of immutable
chunk events**.

## The idea

```text
corpus/*.md → ingest workflow → rag.chunk.embedded events → external projection → rag.db (sqlite-vec) → ask
```

The embedding rides inside the event. That one choice is what makes the index
rebuildable: delete `rag.db`, replay the events, and the index comes back
without a single embedding-API call.

## Two databases, one rule

| Database | Owner | Holds |
|---|---|---|
| Ironflow's own store | Ironflow | runs, steps, events |
| `rag.db` | this app | chunk text + vectors |

The app never opens a socket to Ironflow's database. Everything Ironflow knows
is reached through `@ironflow/node`. `rag.db` is app-owned and disposable.

## Run it

Three terminals from the repo root: T1 the engine, T2 the worker, T3 your
commands.

```bash
# T1 — the engine.  `embed` matters: a plain `make build` produces a binary
# whose `serve` refuses to start ("embedded dashboard missing").
make embed build && ./build/ironflow serve
```

The first start writes a bootstrap admin key. You need it — the server refuses
unauthenticated function registration with a bare 401.

```bash
# T2 — configure and start the worker
cd examples/rag-core
cp .env.example .env
# paste this into IRONFLOW_API_KEY in .env:
cat ../../.ironflow/.ironflow_bootstrap_key.json | jq -r .key

pnpm install && pnpm setup && pnpm start
```

Expected:

```text
VOYAGE_API_KEY is not set — using the offline stand-in embedding.
rag-core worker running
[ironflow-worker] Registered function: ingest-corpus
[ironflow-worker] Projection runner started (streaming): vector-index
```

```bash
# T3 — ingest
pnpm ingest
```

Expected, in T2:

```text
[ironflow-worker] Processing job <id> for ingest-corpus
[ironflow:<id>] ingest complete { docs: 3, chunks: 11 }
```

```bash
# T3 — ask
pnpm ask "What port does the Forge dev server use?"
```

Expected: the top hits are `[troubleshooting#Port already in use]` and
`[getting-started#The dev server]`, both naming port 4311.

### No API keys? It still runs.

Without `VOYAGE_API_KEY` the example uses a deterministic offline stand-in
embedding — hashed token buckets, L2-normalised. It is **not** semantic. It is
enough to prove the pipeline end to end and nothing more. Without
`ANTHROPIC_API_KEY`, `ask` prints the retrieved context instead of an answer.

## Exercise 1 — rebuild the index from events

This is the point of the whole design. It needs two terminals, because
`pnpm start` blocks — it is the worker, and it never returns.

```fish
# T2 — stop the worker (Ctrl-C), throw the index away, restart the worker
rm rag.db
pnpm setup
pnpm start
```

Wait for this line before going on. `projection rebuild` looks the projection up
in the server's registry, and it only lands there once the worker has started
it:

```text
[ironflow-worker] Projection runner started (streaming): vector-index
```

```fish
# T3 — pnpm scripts load .env via tsx; `ironflow` does not. Export it yourself.
set -x IRONFLOW_API_KEY (cat ../../.ironflow/.ironflow_bootstrap_key.json | jq -r .key)
../../build/ironflow projection rebuild vector-index
```

zsh/bash:

```bash
export IRONFLOW_API_KEY=$(cat ../../.ironflow/.ironflow_bootstrap_key.json | jq -r .key)
../../build/ironflow projection rebuild vector-index
```

Without the export the command fails with a bare 401. `pnpm ingest` works from
the same directory only because the app scripts in `package.json` (`setup`,
`start`, `dev`, `ingest`, `ask`) pass `--env-file-if-exists=.env` to tsx. The
`ironflow` binary has no equivalent — it reads `IRONFLOW_API_KEY` from the
process environment and nowhere else.

The rebuild command returns as soon as it resets the cursor; the runner drains
the events on its next poll. Leave the worker up so you can watch it finish.

The index comes back from the event stream. **Zero embedding-API calls** — the
vectors were in the events all along. Verified: 11 chunks restored from 20
events.

## Exercise 2 — kill it mid-ingest

Start an ingest, kill the worker, restart it. Read **Known limits** below first,
so you know what to expect — it is not quite what "durable execution" suggests.

## Why pull mode

`worker.ts` uses `createWorker`, not `serve()`. **Do not port it.**

The vector index is an external projection, and push mode cannot host one.
`serve()` accepts a `projections` array in its config type, then logs
`Projections in push mode are not supported. Use createWorker() for
projections.` and drops it on the floor. Only `createWorker` runs a projection
runner.

Ingest wants pull mode anyway: push is an HTTP POST with a ~10s budget, and
chunking plus embedding a corpus has no ceiling. Pull holds the job open for as
long as it takes.

This is a different reason from
[`examples/financial-rag`](../financial-rag/), which is forced onto pull mode by
a step-key collision in the push executor's multi-turn agent loop
([#1647](https://github.com/sahina/ironflow/issues/1647)). rag-core has no agent
loop and does not hit that. The whole series stays on pull mode regardless.

## Known limits

Measured while building this example, not guessed.

- **A killed worker does not resume where it left off.** A pull worker ships
  step results only when the job finishes; there is no incremental checkpoint,
  and nothing wires the SDK's `drain()` to a signal. Ctrl-C is as lossy as
  `kill -9`. Measured: 3 seconds into a 3000-document ingest, both signals left
  **zero** persisted steps, and the reclaimed run re-processed all 3000
  documents. The run still ends **correct** — every emit carries a
  content-derived `idempotencyKey`, so the duplicates are dropped and the index
  has no double rows. Correct, not cheap.
- **Recovery takes 90s to 3 minutes.** After the worker dies the run sits in
  `running`, then flips to `waiting`. A live, connected, idle replacement worker
  will not pick it up until the clock runs out. At the 30-second mark it looks
  broken. It is not; wait. The gate is the dead worker's **concurrency lease**
  (90s) plus a 30s scanner tick, a 30s recovery grace, and a 30s pull-dispatch
  tick. The `running` → `waiting` flip is the halfway mark, not the end — the
  grace timer starts there. Nothing logs this and no run field counts it down.
  `--dev` does not shorten it, and neither does `IRONFLOW_STALE_CLAIM_THRESHOLD`
  (that tunes a different loop, which skips any run holding a lease). The lease
  timings have no flag, YAML field or environment variable. See
  [Crash recovery](../../docs/explanation/crash-recovery.md).
- **`step.map` branches are only durable if you use the scoped `step`
  argument.** `async (item) => {...}` persists one step for the entire map.
  `async (item, docStep) => docStep.run(...)` persists one per item. Both
  typecheck. Since #1671 the SDK logs a warning when every branch in a call
  skips the scoped client; pass `{ expectScopedClient: false }` for a fan-out
  that genuinely has nothing to memoize. See the comment in
  `workflows/ingest-corpus.ts`.
- **The vector index has to live outside Ironflow — on SQLite.** #1641 shipped
  indexable SQL projections and allowlists the `vector` extension, so a managed
  projection *can* hold a vector index on PostgreSQL. pgvector is
  PostgreSQL-only, and this example is deliberately Postgres-free, so `rag.db`
  is an external projection. That is the one component writing outside the
  platform. Part 6 does the pgvector swap.
- **`ask` bypasses Ironflow entirely.** Retrieval plus one model call is
  request/response, and there is no ergonomic "emit an event, get the run's
  result back" client path today.
- **Tests are not wired into CI.** `pnpm test` covers pure logic only —
  chunking, ids, the offline embedding, the store round-trip. Workflows are
  verified by running them.

## Deliberately not here

Each of these is a later part of the series, not an oversight:

- change detection, deletes, re-indexing, upcasters → part 2 (rag-freshness)
- golden sets, shadow indexes, promote-or-rollback → part 3 (rag-evals)
- per-tenant corpora and retrieval boundaries → part 4 (rag-tenants)
- multi-step retrieval, reranking, streaming → part 5 (rag-agentic)
- recovery, observability, cost, pgvector swap → part 6 (rag-ops)

For a production-shaped RAG application today, read
[`examples/financial-rag/`](../financial-rag/): recurring ingest, hybrid search
over pgvector, an agentic query loop, and an eval gate.

## Layout

```text
corpus/          three fictional docs about a CLI tool called Forge
src/id.ts        stableId — deterministic ids, used as idempotency keys
src/chunk.ts     markdown → chunks, split by heading, capped at paragraphs
src/embed.ts     voyage-4, with the deterministic offline fallback
src/db.ts        sqlite-vec: schema, idempotent insert, KNN search
events.ts        the event contract — the index is a function of these
workflows/       the durable ingest workflow
projections/     the external projection that writes rag.db
worker.ts        createWorker — pull mode
cli.ts           pnpm ingest / pnpm ask
```
