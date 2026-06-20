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
| [reference-app/](./reference-app/)               | Full API validation       | SDK contributors, QA  | Exhaustive feature coverage (30+ pages)     |

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
```
