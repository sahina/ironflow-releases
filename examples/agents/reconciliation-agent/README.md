# reconciliation-agent

Durable exception resolution for bank reconciliation. A statement carries ~100 transactions.
A deterministic pass matches most of them. The residue clusters by counterparty into cases.
Each case goes through an LLM triage, a human approval, a real outbound message to the
counterparty, and a durable wait for their reply — or for nobody to reply at all. A
confirmed resolution becomes a rule, so the next statement needs the model less.

## What this adds

`code-review-agent` shows `tool()` + `llm()` + `approve()` + a durable wait.
`doc-processor-agent` shows `memory.append()` over an entity stream, plus crash-resume.
This example is not a recombination of the two. It adds five things neither has:

1. **A deterministic pass that carries measurable volume before any model runs.** One
   `step.run` matches ~90 of ~100 transactions by exact lookup. Only the residue reaches
   an LLM.
2. **A reply from an external party, not an internal approver.** `approve()`'s human is
   inside the org. The counterparty's reply is outside it, and the run has to wait for it
   indefinitely — or for nobody to answer.
3. **Redaction and authorization applied before data reaches a model.** Every field the
   model sees passes through one function first. The reply is classified, never read as
   prose.
4. **Prompt-injection threat notes with an enforcing mechanism.** Structured-output-only,
   plus an allowlist check on the proposed action, enforces the note in code instead of
   stating it only in a comment.
5. **Memory reused across cases.** A confirmed resolution feeds the deterministic pass on
   the next statement, not the model's prompt. Reuse raises the match ratio; it does not
   add context to the LLM's prompt.

## Pipeline

```text
statement.received
      |
      v
+-------------------------------+
| reconcile run                 |
|  step.run("reconcile")        |  one step, pure computation
|   ~90/100 matched             |
|   ~10 -> clusters per         |
|         counterparty          |
|  emit(case.requested, key) xN |
+-------------------------------+
      |
      v  (one run per case)
+---------------------------------------------------------+
| case run                                                 |
|  redact() -> llm() triage -> approve("contact")          |
|                                    |                      |
|                                    v                      |
|                        tool(send, idempotencyKey)         |
|                                    |                      |
|                                    v                      |
|               waitForEvent("case.resolution.signal")      |
|                 kind: "reply" | "timeout"                 |
|                                    |                      |
|                                    v                      |
|                case.resolved | case.unresolved            |
|                -> learned rule (per counterparty)         |
+---------------------------------------------------------+

sweep (cron, */5m): reads the operational projection, switches
                     on stage, emits the deadline event for that stage
```

## Quick start

```bash
# Server
ironflow serve --dev

# SDK build (once)
pnpm -C ../../../sdk/js build

# Install + run worker
pnpm install
pnpm dev

# Trigger a statement (separate terminal)
pnpm trigger

# The case runs start independently, once per cluster. Find one waiting at the
# approval gate:
pnpm exec tsx scripts/find-pending.ts

# Approve it. Only this run advances; the draft it is about is on the parked
# step's `input` (`client.getRunSteps(runId)`, or the dashboard):
pnpm approve -- <runId> true

# Signal a counterparty reply for that case:
pnpm reply -- <caseId> "the amount posted to our sibling account"
```

## Seeing reuse happen

Trigger a statement, resolve one case, then trigger a second statement and watch the
ratio move:

```bash
pnpm trigger                                  # statement #1: matchedRatio ~0.90, escalated ~5
# approve one case, then pnpm reply -- <caseId> "..."
# case.resolved fires; reconciliation-curated-rules gains a rule for that counterparty
pnpm trigger                                  # statement #2 (same fixture)
```

The second run's output carries `rulesApplied` non-empty, `matchedRatio` up from the
first run, and `escalated` down by one — the resolved counterparty's residue transactions
matched the learned rule instead of escalating again.

`escalated` counts *clusters*, so it always drops 5 -> 4. `matchedRatio` counts
*transactions*, and how far it moves depends on which case you happened to resolve: the
fixture's residue is spread unevenly (Vendor E has 1 line, Vendors A/B/C have 2, Vendor D
has 3). Resolving Vendor E gives 0.90 -> 0.91, A/B/C 0.90 -> 0.92, D 0.90 -> 0.93.
`find-pending.ts` returns whichever run the API lists first, so expect any of the three.

Repeated triggers for the same period/counterparty reuse the existing case, including
while it is still waiting. The parent emits `reconciliation.case.requested` with a stable
idempotency key; server-side deduplication prevents concurrent statements from starting
duplicate cases. This applies while the request event is retained. A closed case is also
reused; this example does not reopen it. A new period creates a new case. Only the
still-waiting half of that is exercised by `demo-crash-resume.sh` — closed-case reuse and
the new-period path are unreachable with the single-period fixture, so both are reasoned
from the idempotency key, not demonstrated.

The worker and scripts use `IRONFLOW_URL`, then `IRONFLOW_SERVER_URL`, then
`http://localhost:9123`. Startup makes the selected URL available to agent memory too.
Both `pnpm approve -- ...` and `pnpm approve ...` work; invalid boolean values are rejected.

## Crash-resilience: idempotent outbound contact

`step.run` memoization protects a step that *completed*. It does not protect the window
between the provider accepting a message and the step's result persisting — kill the
worker there and a naive resume sends again. This example derives a deterministic key
from `(runId, decisionId)` and passes it *to the provider*, which dedupes on it:

```bash
./scripts/demo-crash-resume.sh    # also: make demo-reconciliation-crash
```

The script first checks that two concurrent statements share five case runs. It then
approves one case, kills the worker mid-send, restarts it, and asserts the provider ledger holds exactly one delivery for that key.

**Which test proves which half.** `pnpm test` (`tests/contact.test.ts`) proves the key
derivation and that the mock provider dedupes on a repeated key — it does not prove
anything about crash-resume, because `createTestClient` runs a handler in-process to
completion and cannot model a kill mid-run. The `ci-full` gate runs
`demo-crash-resume.sh` against a real server, using `kill -9` to verify the resume
half of the idempotency claim. A reader
who sees only the green unit test has verified half the claim.

## Stated bounds

This example was built and run against a live server, not just typechecked. Every bound
below was found that way, and each is asserted or worked around in code — not left for a
reader to discover.

- **Redaction lives in application code, not the engine.** Ironflow's CEL policy layer
  (`docs/explanation/policies.md`) is deny-only and subtractive — it cannot redact a
  field — and the layered evaluator that would add authorization on top is wired by
  tests only, not by the running server. `src/redact.ts` is the model boundary here, and
  it exists because the engine has no equivalent. Do not read this example as a gesture
  at an engine capability that exists.
- **The sweep is a demo affordance, not production code.** It publishes into
  `agent.approve.contact` so a stuck approval can resolve without a human — which means
  anything with permission to emit that event can settle *any* pending approval. A real
  deployment locks that subject down. `tests/sweep.test.ts` asserts the invariant that
  bounds the damage: the sweep can only ever emit `approved: false`, and because
  `approve()` correlates on `data.runId` a rejection lands on exactly one run.
- **The run's real deadline lives in the sweep, not in the wait.** The engine fails a run
  outright when a `waitForEvent` TTL elapses instead of resuming it — the documented
  contract since #2185: `approve()` never returns a timeout result. The sweep emits each
  stage's deadline event on its own schedule, well before either wait's TTL could fire,
  so the run always resumes through its own code instead of dying on the engine timeout.
  That last claim is reasoned, not demonstrated: `DEADLINE_HOURS` is 24 (`src/memory.ts`),
  so every tick inside a walkthrough logs `sweep complete { emitted: 0 }` and the emit
  path never runs. `tests/sweep.test.ts` covers `deadlineEventFor` in isolation; nothing
  drives a real deadline to expiry against a live server.
- **Memory is one growing stream.** `MemoryConfig.streamId` is a static string and
  `memory.entityStream()` — the per-key escape a production deployment would want — is
  unimplemented. The curated projection keys its state by counterparty inside one
  stream instead of giving each counterparty its own stream.
- **A learned rule is not cause-specific.** `learnRule` always parameterizes the same
  fixed predicate (`{ kind: "label-prefix", prefix: "ADJ-" }`) regardless of which cause
  the triage classified. A confirmed resolution therefore fires on every `ADJ-`-prefixed
  residue line for that counterparty, whatever its actual cause. Defensible for an
  illustrative example — a human authorized the parameters at approval time — but the
  rule is broader than its name suggests.
- **Renaming the approval breaks a link no test can catch.** `EVENTS.ApproveContact`
  must equal the literal `"agent.approve."` plus the name string passed to `approve()`
  in `src/agent.ts`. The SDK does not export `APPROVE_EVENT_PREFIX`, so nothing can
  derive or assert the two agree — change one without the other and the sweep's
  rejections silently stop matching.
- **The counterparty pseudonym is unsalted SHA-256** over a small, guessable vendor set,
  so it is brute-forceable from the fixture data alone. Fine for illustrative fixture
  data, not a real anonymization scheme.
- A real deployment fetches the statement from wherever it lives rather than receiving
  ~100 transactions inline on the trigger event, as this example's fixture does.

## Files

- `src/statement.ts` — the reconcile run: one deterministic pass, then a detached case
  request per residue cluster
- `src/agent.ts` — the case agent: triage, approved contact, durable reply wait, curated
  resolution
- `src/reconcile.ts` — the matcher, the closed predicate grammar, and learned-rule shape
- `src/redact.ts` — the model boundary: what the model sees and does not
- `src/config.ts` — shared server URL for the worker, scripts, and agent memory
- `src/llm.ts` — the fake triage classifier (real-provider reference in a comment) and
  its structured-output allowlist check
- `src/contact.ts` — the idempotency key, the fixture provider, and the draft message
- `src/memory.ts` — both projections: operational (stage + deadline) and curated
  (learned rules, `case.resolved` only)
- `src/sweep.ts` — the cron deadline emitter
- `src/events.ts` — event names shared by the agent, the sweep, and the scripts
- `src/worker.ts` — pull-mode worker entrypoint
- `scripts/trigger.ts` — emit `statement.received` from `fixtures/statement.json`
- `scripts/approve.ts` — emit the contact approval event for a `runId`
- `scripts/reply.ts` — classify a reply locally and signal it for a `caseId`
- `scripts/find-pending.ts` — find a case run waiting at the approval gate
- `scripts/demo-crash-resume.sh` — the mid-send kill -9 demo
- `fixtures/statement.json` — ~100 transactions, ~90 matched, ~10 escalated, generated
  by `scripts/build-statement.ts` and checked against it in `tests/fixtures.test.ts`

## Next steps

- [Code-review agent](../code-review-agent/) — `tool()` + `llm()` + `approve()` against
  an internal approver.
- [Doc-processor agent](../doc-processor-agent/) — crash-resume with `memory.append()`
  in its simplest form.
- [Tutorial: durable exception resolution](../../../docs/tutorials/reconciliation-exception-resolution.md)
  — the narrative walkthrough of this example.
