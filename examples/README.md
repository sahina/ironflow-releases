# Ironflow Examples

Ironflow is a **Continuous History** platform — record every change as an immutable event, react with durable workflows, derive read models automatically, and rewind to any moment.

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
| [quickstart/](./quickstart/)                     | Core CH flow in 5 minutes | Getting started       | All four pillars in ~80 lines               |
| [ddd-order-management/](./ddd-order-management/) | DDD patterns on Ironflow  | Building real systems | Aggregates, CQRS, sagas, commands vs events |
| [cqrs-order/](./cqrs-order/)                     | CQRS walkthrough, runnable | Tutorial companion     | Implements `docs/tutorials/cqrs-walkthrough.mdx` step-by-step |
| [go-quickstart/](./go-quickstart/)               | Go SDK validation         | Go developers         | Same CH flow in Go                          |
| [todo-web/](./todo-web/)                         | Bare-bones Next.js todo   | Getting started       | Embedded worker, events, projections        |
| [travel-booking/](./travel-booking/)             | The 90-second showcase demo | Anyone new to Ironflow | Saga rollback, crash-resume, a race for the last seat, time travel |
| [reference-app/](./reference-app/)               | Full API validation       | SDK contributors, QA  | Exhaustive feature coverage (30+ pages)     |
| [fraud-detection/](./fraud-detection/)           | Real-time risk pipeline   | Building real systems | `step.parallel()`, KV counters, pub/sub alerts |
| [compliance-audit/](./compliance-audit/)         | Audit trail + execution proof | Regulated workloads | Entity-stream lineage in the Compliance dashboard |
| [ai-agent/](./ai-agent/)                         | Durable AI research agent | AI engineers          | `agent()`, `tool()`, `llm()`, event-sourced memory |
| [agents/doc-processor-agent/](./agents/doc-processor-agent/) | Crash-resume proof | AI engineers      | `kill -9` mid-pipeline and resume; browser demo in [`web/`](./agents/doc-processor-agent/web/) |
| [agents/code-review-agent/](./agents/code-review-agent/) | Human-in-the-loop gate | AI engineers    | `approve()` pausing a run for up to 24h     |
| [financial-rag/](./financial-rag/)               | RAG with an eval gate     | AI engineers          | Shadow index, golden-set eval, promote-or-rollback saga |
| [rag-core/](./rag-core/)                         | RAG part 1: event-sourced index | AI engineers    | Zero-Docker RAG: durable ingest, embeddings in events, sqlite-vec projection |
| [yaml-config/](./yaml-config/)                   | Config file examples      | Operators             | Server, cluster, and platform `ironflow.yaml` |

## Prerequisites

- Go 1.25+ (required to build Ironflow)
- Node.js 22+ and pnpm (for TypeScript examples)

## Quick Reference

```bash
# Build everything (binary + JS SDK + dashboard)
make all

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

# Run the Go quickstart
cd examples/go-quickstart && go run main.go

# Run the reference app
cd examples/reference-app && pnpm install && pnpm dev

# Run the fraud detection pipeline
cd examples/fraud-detection && pnpm install && pnpm start
# In another terminal: pnpm seed

# Run the compliance audit demo (worker first — seeding first yields no execution proof)
cd examples/compliance-audit && pnpm install && pnpm tsx worker.ts
# In another terminal: pnpm tsx setup.ts

# Run the AI research agent
cd examples/ai-agent && pnpm install && pnpm dev
# In another terminal: ironflow emit agent.research --data '{"topic":"event sourcing"}'

# Run the agent examples (doc-processor-agent, code-review-agent)
cd examples/agents/doc-processor-agent && pnpm install && pnpm dev
# In another terminal: pnpm trigger -- doc-1 https://example.com/invoice.png

# Validate the YAML configuration examples (no install needed)
./build/ironflow validate -f examples/yaml-config/ironflow.yaml
```
