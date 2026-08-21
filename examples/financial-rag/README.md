# Financial-document RAG

A RAG app where a new batch of documents is treated like a deploy: shadowed,
tested against a golden set, then promoted or rolled back.

Design overview with diagrams: [`docs/design.html`](docs/design.html).

## What it does

Every 15 minutes it hashes a folder of filings and ingests anything new. Claude
reads each PDF and extracts prose, table rows, and a plain-English summary of
each table. Those land in a **shadow index** that nothing can query yet. An eval
runs a golden set against that shadow index. Only if it passes does the live
pointer move — and if the flip fails verification, a saga puts it back.

Most RAG demos stop at "it returned something". The point here is the last step:
**the system refuses to publish an index that got worse.**

## Running it end to end

Requires Docker, Node 24+, pnpm, and an `ANTHROPIC_API_KEY`. You need **three
terminals**: one for Postgres and setup, one for the engine, one for the worker.

### 1. Build the SDK and the engine

From the repo root. The example links your local SDK build, so this has to
happen first.

```bash
# `embed` is not optional. From a fresh clone a plain `make build` produces a binary
# whose `serve` exits "embedded dashboard missing (static/index.html not found)".
make embed build
pnpm --filter "./sdk/js/*" build
```

### 2. Start Postgres

```bash
cd examples/financial-rag
pnpm install
cp .env.example .env         # then put a real ANTHROPIC_API_KEY in it
docker compose up -d --wait  # --wait blocks until Postgres is accepting queries
```

One container, two databases: `ironflow` and `ragapp`. `initdb.sql` creates the
second and enables pgvector on it. Without `--wait` the next command races the
database.

Every `pnpm` script here loads `.env` via Node's `--env-file-if-exists`, so no
`export` and no `dotenv` dependency.

### 3. Start the engine — terminal 2

```bash
# from the repo root
IRONFLOW_DATABASE_URL="postgres://ironflow:ironflow@localhost:5434/ironflow" \
  ./build/ironflow serve
```

Leave it running. Wait for `server listening` before continuing.

### 4. Register projections and build the corpus

```bash
cd examples/financial-rag
pnpm setup          # 3 SQL projections in Ironflow + the ragapp schema
pnpm seed-corpus    # writes two synthetic filings into corpus/
```

`pnpm setup` prints:

```
  ✓ documents (created)
  ✓ table_rows (created)
  ✓ eval_results (created)
  ✓ chunks, index_pointer
```

`pnpm seed-corpus` writes `ACME_2024-Q3_2024-11-01.pdf` and
`ACME_2024-Q3_2025-02-14.pdf` — the same quarter filed twice, the second one
restating revenue downward. That pair is what makes the restatement rule
observable.

### 5. Start the worker — terminal 3

```bash
cd examples/financial-rag
pnpm start
```

Prints `financial-rag worker running`, plus a loud warning if `VOYAGE_API_KEY`
is unset (see below).

### 6. Trigger the pipeline

Back in terminal 1. The cron fires every 15 minutes; this fires the same event
now.

```bash
pnpm poll
```

Watch terminal 3. You should see, in order:

```
parsed filing   { docId: 'ACME_2024-Q3_2024-11-01', chunks: N, rows: M, tables: K }
parsed filing   { docId: 'ACME_2024-Q3_2025-02-14', ... }
batch closed    { batchId: '...', parsed: 2 }
scored          { id: 'revenue-restated', ... }        ← one per golden row
eval complete   { indexVersion: 1, passed: true, ... }
index promoted  { indexVersion: 1, previous: 0 }
```

`index promoted` is the moment the data becomes queryable. Everything before it
runs against a shadow index that no query can reach.

The whole chain is inspectable:

```bash
./build/ironflow inspect <run_id>    # run_id is in the worker log
```

### 7. Ask a question

```bash
pnpm ask "What was ACME's total revenue in Q3 2024?"
```

The correct answer is **1,251,000** with a citation — the restated figure, not
the 1,284,000 in the original filing. If you get 1,284,000, supersession is
broken. If you get both, it is broken in a different way.

### If the eval does not pass

Expected, and the interesting case. `eval complete` shows `passed: false`, no
`index promoted` line follows, the pointer stays where it was, and `pnpm ask`
reports an empty corpus on a first run. That is the gate working — a candidate
index that cannot answer the golden set does not go live.

The verdict names the failing question IDs. `run-eval` logs a `scored` line per
row, so compare its `retrievalPassed` and `numericPassed` against the tiers
table below to see which stage broke.

**Running without `VOYAGE_API_KEY` makes this much more likely.** The offline
fallback is a deterministic hash, not a semantic embedding, so the retrieval
tier is close to meaningless. It exists to prove the pipeline runs end to end
without a Voyage account, not to produce good answers.

### Tear down

```bash
docker compose down -v       # -v also drops the data, so initdb.sql re-runs
```

## The two-database rule

One Postgres server, two databases, and the application never opens a socket to
Ironflow's:

| Database   | Owner        | Holds                                             | Reached via           |
| ---------- | ------------ | ------------------------------------------------- | --------------------- |
| `ironflow` | Ironflow     | event streams, three SQL projections, run history | `@ironflow/node` only |
| `ragapp`   | this example | `chunks` (pgvector + tsvector), `index_pointer`   | the app's own pool    |

`src/db.ts` is the only file that opens a Postgres connection, and it connects
exclusively to `ragapp`. pgvector is installed on `ragapp` and nowhere else —
`initdb.sql` enforces that. **Ironflow never stores a vector.**

Verify it:

```bash
docker compose exec postgres psql -U ironflow -d ironflow -c "\dt proj_*"
docker compose exec postgres psql -U ironflow -d ragapp   -c "\dt proj_*"
```

Three tables in the first, zero in the second. If a `proj_` table shows up in
`ragapp`, the boundary is broken.

## Why pull mode

All four workflows use `createWorker`, not `serve()`. **Do not port them.**

The agent loop calls `step.run("llm.turn")` once per turn. The SDK
disambiguates that into `run:llm.turn:0,1,2…`, but the push executor persists
steps keyed on the raw *name* against a `UNIQUE (run_id, step_id)` constraint.
Under `serve()`, every turn after the first overwrites turn 1's row, so any
retry or resume replays turn 1 with the last turn's answer and re-executes the
rest against the live API. Pull mode keys on the unique ID and is unaffected.

Tracked as [#1647](https://github.com/sahina/ironflow/issues/1647).

## The eval

Three tiers, cheapest first, because they fail for different reasons:

| Tier      | Question                                              | Cost           |
| --------- | ----------------------------------------------------- | -------------- |
| Retrieval | Did the right chunk come back at all?                 | no model call  |
| Numeric   | Is the figure exactly right?                          | no model call  |
| Agent     | Does the full loop answer correctly, with a citation? | full agent run |

A retrieval failure means chunking or embedding broke. A numeric failure with
retrieval passing means table extraction broke. An agent failure with both
passing means the prompt or the tools broke. One aggregate number would have
told you none of that.

Only the numeric tier gates promotion, at 90%. An eval that scored zero
questions does **not** promote — see `passesGate`, and the test that pins it.

## Tests

```bash
pnpm test        # unit tests
pnpm typecheck
```

These cover the logic where a silent bug produces a plausible wrong number:
hashing and the changed-set diff, PDF range math, hybrid query construction and
SQL escaping, restatement supersession, the citation gate, and golden-set
scoring. One test asserts the golden set still matches the generated corpus, so
editing a figure in one place and not the other fails rather than silently
corrupting the gate.

**Not wired into CI.** Like `make ci` generally, they are enforced by humans.
The workflows themselves are verified by running them, not by a test harness.

## Deliberately not here

- **Reranking** — a commented hook in `src/retriever.ts`. It helps, it costs a
  model call per query, and the example is clearer without it on.
- **Index scale-up** — the hybrid query is a full scan, on purpose. It computes
  distance and `ts_rank` in the SELECT list and sorts on a blended score, which
  no ANN or full-text index can serve, so `src/db.ts` creates neither. Correct
  at demo scale; `createSchema`'s comment has the Reciprocal Rank Fusion
  rewrite for a real corpus.
- **Standalone publishing** — this runs inside an Ironflow checkout, against
  your local SDK build.

## Known limit

The gate is only as good as the golden set. Thirteen questions catch gross
regressions, not subtle ones. Growing the set is the honest way to strengthen
it; there is no clever substitute.
