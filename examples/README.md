# Ironflow Examples

Ironflow is one binary for durable execution, pub/sub and event sourcing. Its **Continuous History** model: record changes as immutable events, react with durable workflows, derive read models, and rewind to a recorded moment.

These examples demonstrate the core concepts and validate the SDK.

## The Continuous History Model

Every Ironflow application follows four pillars:

| Pillar     | What It Does                                    | Ironflow Primitive                    |
| ---------- | ----------------------------------------------- | ------------------------------------- |
| **Emit**   | Record events as permanent, immutable facts     | `emit()`, `streams.append()`          |
| **React**  | Process events with durable, memoized workflows | Functions with `step.run()`           |
| **Derive** | Build read models from event streams            | Projections (pure reducers)           |
| **Rewind** | Time-travel to any moment for debugging         | `recording: true`, `ironflow inspect` |

## Learning Path

| Example                                          | Purpose                   | Audience              | What You'll Learn                           |
| ------------------------------------------------ | ------------------------- | --------------------- | ------------------------------------------- |
| [quickstart/](./quickstart/)                     | Core CH flow in 5 minutes | Getting started       | All four pillars in ~110 lines               |
| [ddd-order-management/](./ddd-order-management/) | DDD patterns on Ironflow  | Building real systems | Aggregates, CQRS, sagas, commands vs events |
| [cqrs-order/](./cqrs-order/)                     | CQRS walkthrough, runnable | Tutorial companion     | Implements `docs/tutorials/cqrs-walkthrough.mdx` step-by-step |
| [go-quickstart/](./go-quickstart/)               | Go SDK validation         | Go developers         | Same CH flow in Go                          |
| [todo-web/](./todo-web/)                         | Bare-bones Next.js todo   | Getting started       | Embedded worker, events, projections        |
| [travel-booking/](./travel-booking/)             | The 90-second demo | Anyone new to Ironflow | Saga rollback, crash-resume, a race for the last seat, time travel |
| [reference-app/](./reference-app/)               | Polyglot order processing | Multi-language systems | Go, TypeScript and Python services on one Ironflow backend: entity streams, a durable wait, durable steps, Pub/Sub and crash recovery |
| [file-upload/](./file-upload/)                   | File storage in Python    | Python developers     | Buckets, signed URLs, a worker on `ironflow.file.created` |
| [flask-single-container/](./flask-single-container/) | App + engine as one deployable unit | Shipping a small app | Flask, a pull-mode worker and the engine in one container with one volume |
| [deletion-redaction/](./deletion-redaction/)     | Customer data removal checks | Compliance-minded teams | A Python push app driven by an integration test: redact, delete and purge, and what each leaves behind |
| [fraud-detection/](./fraud-detection/)           | Real-time risk pipeline   | Building real systems | `step.parallel()`, KV counters, pub/sub alerts |
| [compliance-audit/](./compliance-audit/)         | Audit trail + execution proof | Regulated workloads | Entity-stream lineage in the Compliance dashboard |
| [ai-agent/](./ai-agent/)                         | Durable AI research agent | AI engineers          | `agent()`, `tool()`, `llm()`, event-sourced memory |
| [agents/doc-processor-agent/](./agents/doc-processor-agent/) | Crash-resume proof | AI engineers      | `kill -9` mid-pipeline and resume; browser demo in [`web/`](./agents/doc-processor-agent/web/) |
| [agents/code-review-agent/](./agents/code-review-agent/) | Human-in-the-loop gate | AI engineers    | `approve()` pausing a run for up to 24h     |
| [notifier/](./notifier/) | Failure notifications | Operators | Public system subscriptions, KV rules, restart dedupe and optional Slack webhooks |
| [agents/slack-approvals/](./agents/slack-approvals/) | Approval buttons | AI engineers | Durable gates answered through a local inbox or signed Slack interactions |
| [agents/reconciliation-agent/](./agents/reconciliation-agent/) | Durable exception resolution | AI engineers | A deterministic pass before the model, a reply from outside the org, idempotent outbound contact |
| [financial-rag/](./financial-rag/)               | RAG with an eval gate     | AI engineers          | Shadow index, golden-set eval, promote-or-rollback saga |
| [rag-core/](./rag-core/)                         | RAG part 1: event-sourced index | AI engineers    | Zero-Docker RAG: durable ingest, embeddings in events, sqlite-vec projection |
| [yaml-config/](./yaml-config/)                   | Config file examples      | Operators             | Server, cluster, and platform `ironflow.yaml` |

## Prerequisites

- Go 1.27+ (required to build Ironflow)
- Node.js 22+ and pnpm (for TypeScript examples; `reference-app/` needs 24.2+). Building the SDK from this checkout (`pnpm -C sdk/js build`) is supported on the repo's Node 24.
- Python 3.10+ (for `reference-app/`'s notification service, `file-upload/` and `deletion-redaction/`)
- Docker (for `flask-single-container/` and `financial-rag/`)

## Before you run

- **Server URL.** Every command below assumes the engine on `localhost:9123`. On another port, set
  `IRONFLOW_SERVER_URL` — the `ironflow` CLI, the SDKs and the example scripts read that variable.
- **Simulated integrations.** The agent examples and `rag-core` run without paid providers: tools, OCR,
  triage and model replies are deterministic stand-ins, and outbound messages go to local files.
  `financial-rag` needs `ANTHROPIC_API_KEY` (extraction fails without it); `rag-core` falls back
  to an offline embedding and its `ask` prints the retrieved context instead of an answer. Each
  README states exactly what is real.
- **Crash-resume timing.** After a worker `kill -9`, an in-flight run resumes when its lease expires:
  roughly 2–3 minutes with default settings, not instantly.

## Quick Reference

> Every TypeScript example is its own pnpm workspace that includes `../../sdk/js/*`, so the
> `pnpm install` lines below re-point the **shared** SDK packages at that
> example's store. Never `rm -rf node_modules` inside an example without
> repairing the SDK afterwards — `rm -rf sdk/js/*/node_modules && pnpm install`
> from the repo root. [`travel-booking/README.md`](./travel-booking/README.md#run)
> has the full note.

```bash
# Build the binary with the embedded dashboard (does NOT build the JS SDK)
make embed build

# Start the server
./build/ironflow serve --dev

# Build the JS SDK (required for all TypeScript examples)
pnpm -C sdk/js build

# Run the TypeScript quickstart
cd examples/quickstart && pnpm install && pnpm tsx worker.ts

# Run the todo web app (worker embedded in Next.js — no separate process)
cd examples/todo-web && pnpm install && pnpm dev

# Run the DDD example
cd examples/ddd-order-management && pnpm install && pnpm worker
# In another terminal: pnpm dev

# Run the CQRS walkthrough example
cd examples/cqrs-order && pnpm install && pnpm worker
# In another terminal: pnpm dev

# Run the travel-booking demo (pnpm dev supervises the UI and the worker)
cd examples/travel-booking && pnpm install && pnpm dev

# Run the Go quickstart
cd examples/go-quickstart && go run main.go

# Start the reference app: engine, Go ordering, Node payments, Python notifications
# and the web application, all on discovered ports
make reference-app

# Run the fraud detection pipeline
cd examples/fraud-detection && pnpm install && pnpm start
# In another terminal: pnpm seed

# Run the compliance audit demo (worker first — seeding first yields no execution proof)
cd examples/compliance-audit && pnpm install && pnpm tsx worker.ts
# In another terminal: pnpm tsx setup.ts

# Run the AI research agent
cd examples/ai-agent && pnpm install
export IRONFLOW_SERVER_URL=http://localhost:9123
pnpm dev
# In another terminal: ironflow emit agent.research --data '{"topic":"event sourcing"}'

# Run the agent examples (doc-processor-agent, code-review-agent)
cd examples/agents/doc-processor-agent && pnpm install && pnpm dev
# In another terminal: pnpm trigger doc-1 https://example.com/invoice.png

cd examples/agents/code-review-agent && pnpm install && pnpm dev
# In another terminal: pnpm trigger octocat/hello 42
# Then approve the runId it prints: pnpm run approve <runId>

cd examples/agents/reconciliation-agent && pnpm install && pnpm dev
# In another terminal: pnpm trigger, then pnpm exec tsx scripts/find-pending.ts
# Approve a case: pnpm run approve <runId> true
# Then signal the counterparty's reply: pnpm reply <caseId> "..."

# Run the notifier (console alerts; Slack webhook optional)
cd examples/notifier && pnpm install && pnpm start
# In another terminal from that directory: pnpm demo

# Run the approvals worker and inbox in separate terminals
cd examples/agents/slack-approvals && pnpm install && pnpm worker
# In another terminal from that directory: pnpm start
# Then: pnpm trigger, open http://127.0.0.1:9138 and choose Approve or Reject

# Run the RAG part 1 example (no Docker; needs a bootstrap API key in .env)
cd examples/rag-core && pnpm install && pnpm run setup && pnpm start
# In another terminal: pnpm ingest, then pnpm ask "..."

# Run financial RAG (needs Docker + ANTHROPIC_API_KEY + engine bootstrap key).
# Follow its README steps 1–3 to start Postgres and the configured engine first.
cd examples/financial-rag && pnpm install && docker compose up -d --wait
# Then put the engine bootstrap key in .env and run: pnpm run setup && pnpm seed-corpus && pnpm start
# In another terminal: pnpm poll, then pnpm ask "..."

# Run the Python file-storage example (needs a running server; worker and upload in separate terminals)
cd examples/file-upload && pip install -r requirements.txt && python worker.py
# In another terminal: python upload.py

# Prove the single-container Flask example against its pinned engine release (needs Docker)
cd examples/flask-single-container && ./test.sh

# Check customer data removal end to end (Go and Python 3; starts its own server)
go test ./tests/integration -run '^TestDeletionBlogCustomerApp$' -count=1 -v

# Validate the YAML configuration examples (no install needed)
./build/ironflow validate -f examples/yaml-config/ironflow.yaml
```
