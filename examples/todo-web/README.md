# Todo Web App — Ironflow Example

Bare-bones todo app using Next.js + Ironflow. The Ironflow worker runs embedded in the Next.js process via `instrumentation.ts` — no separate worker process needed.

## Architecture

```text
todo.added / todo.toggled / todo.deleted   (browser emits events)
        │
        ▼
  ┌──────────────┐
  │ process-todo │  (Ironflow function — durable, memoized steps)
  └──────────────┘
        │
        ▼
  ┌───────────┐
  │ todo-list │  (Ironflow projection — pure reducer → read model)
  └───────────┘
        │
        ▼
  UI subscribes to projection updates (real-time push)
```

**Events:** `todo.added`, `todo.toggled`, `todo.deleted`
**Function:** `process-todo` — reacts to all three events, runs durable steps with `recording: true`
**Projection:** `todo-list` — managed projection that builds `{ todos: Todo[] }` from the event stream

## Prerequisites

- Ironflow server built: `make all` (from repo root)
- JS SDK built: `pnpm -C sdk/js build` (from repo root)

## Run

```bash
# Terminal 1: Start Ironflow server
./build/ironflow serve --dev

# Terminal 2: Start the todo app
cd examples/todo-web
pnpm install
pnpm dev
```

Open <http://localhost:3000>.

## Files

| File                 | Purpose                                                                           |
| -------------------- | --------------------------------------------------------------------------------- |
| `instrumentation.ts` | Starts Ironflow worker on Next.js boot (function + projection)                    |
| `app/page.tsx`       | Client component — emits events via browser SDK, subscribes to projection updates |
| `lib/ironflow.ts`    | Browser SDK configuration                                                         |
| `app/layout.tsx`     | Root layout with header                                                           |
