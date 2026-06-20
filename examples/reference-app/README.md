# Ironflow Reference App

Comprehensive feature validation app that exercises the full Ironflow SDK surface. **This is not a learning example** — see [quickstart/](../quickstart/) for getting started or [ddd-order-management/](../ddd-order-management/) for DDD patterns.

## Purpose

- Validate every SDK API works end-to-end with a real UI
- Serve as a reference for specific API usage patterns
- Regression testing for SDK changes

## Feature Coverage

| Category | Pages | CH Pillars | Key APIs Validated |
| ---------- | ------- | ------------ | ------------------- |
| Events | 6 | Emit | emit, subscribe, filter, replay, webhooks |
| Workflows | 10 | React | trigger, runs, steps, cron, hot-patch, parallel, invoke, saga, secrets, timeouts |
| Pub/Sub | 3 | Emit, React | publish, subscribe, topics |
| Real-time | 4 | React | connection state, consumer groups, concurrency, workers |
| Event Sourcing | 4 | Emit, Derive, Rewind | streams, projections, subscriptions, upcasting |
| Configuration | 3 | — | config set/patch/watch |
| KV Store | 3 | — | buckets, keys, watch |

## For Contributors

When adding a new SDK feature, add a page here to validate it works end-to-end.

## Prerequisites

- Go 1.25+ (required to build Ironflow)
- Node.js 22+
- pnpm

## Getting Started

1. **Build and start the Ironflow server** (from the repository root):

   ```bash
   make all                       # Build binary and dashboard
   ./build/ironflow serve --dev   # Start server at localhost:9123
   ```

2. **Build the JS SDK and install dependencies**:

   ```bash
   cd examples/reference-app
   pnpm -C ../../sdk/js build   # Build the JS SDK (examples link to local packages)
   pnpm install
   pnpm dev
   ```

3. **Open the application**:
   Navigate to [http://localhost:3000](http://localhost:3000) in your browser.

## Tech Stack

- **Framework**: Next.js 16 with App Router
- **UI**: React 19, Tailwind CSS 4, shadcn/ui (New York style)
- **Ironflow SDKs**:
  - `@ironflow/browser` - Client-side real-time subscriptions
  - `@ironflow/node` - Server-side workflow handlers
- **Form Handling**: React Hook Form with Zod validation
- **Charts**: Recharts
- **Icons**: Lucide React

## Project Structure

```text
examples/reference-app/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── ironflow/        # Ironflow HTTP handler + function registration
│   │   │   └── pubsub/          # Pub/sub publish endpoint
│   │   ├── events/
│   │   │   ├── emit/            # Event emission demo
│   │   │   ├── subscribe/       # Event subscription demo
│   │   │   ├── patterns/        # Pattern matching demo
│   │   │   ├── filtering/       # CEL filter expressions demo
│   │   │   ├── replay/          # Event replay demo
│   │   │   └── webhooks/        # Webhook ingestion demo
│   │   ├── workflows/
│   │   │   ├── trigger/         # Workflow trigger demo
│   │   │   ├── runs/            # Run listing and detail demo
│   │   │   ├── steps/           # Step visualization demo
│   │   │   ├── cron/            # Cron-scheduled workflows demo
│   │   │   ├── hot-patch/       # Hot patching failed steps demo
│   │   │   ├── parallel/        # Parallel execution demo
│   │   │   ├── invoke/          # step.invoke() / invokeAsync() demo
│   │   │   ├── sagas/           # Saga compensation demo
│   │   │   ├── secrets/         # Secrets management demo
│   │   │   └── timeouts/        # Step-level timeouts demo
│   │   ├── pubsub/
│   │   │   ├── publish/         # Topic publishing demo
│   │   │   ├── subscribe/       # Topic subscription demo
│   │   │   └── topics/          # Topic management demo
│   │   ├── realtime/
│   │   │   ├── connection/      # Connection state demo
│   │   │   ├── consumer-groups/ # Consumer groups demo
│   │   │   ├── concurrency/     # Concurrency control demo
│   │   │   └── workers/         # Worker management demo
│   │   ├── event-sourcing/
│   │   │   ├── streams/         # Entity streams demo
│   │   │   ├── projections/     # Projections demo
│   │   │   ├── subscribe/       # Stream subscription demo
│   │   │   └── upcasting/       # Event versioning demo
│   │   ├── config/
│   │   │   ├── configs/         # Config listing demo
│   │   │   ├── editor/          # Config editor demo
│   │   │   └── watch/           # Config watch demo
│   │   ├── kv/
│   │   │   ├── buckets/         # KV bucket management demo
│   │   │   ├── keys/            # KV key operations demo
│   │   │   └── watch/           # KV watch demo
│   │   ├── layout.tsx           # Root layout with providers
│   │   └── page.tsx             # Home page
│   ├── worker.ts                # Pull mode worker script
│   ├── components/
│   │   ├── ui/                  # shadcn/ui components
│   │   ├── app-sidebar.tsx      # Navigation sidebar
│   │   ├── connection-status.tsx # Connection indicator
│   │   ├── error-alert.tsx      # Error display component
│   │   ├── event-card.tsx       # Event card component
│   │   ├── event-emit-form.tsx  # Event emission form
│   │   └── ironflow-provider.tsx # Ironflow client provider
│   ├── lib/
│   │   ├── events.ts            # Shared event-name constants
│   │   ├── functions.ts         # Workflow function definitions
│   │   ├── webhooks.ts          # Webhook definitions
│   │   └── utils.ts             # Utility functions
│   └── hooks/
│       └── use-mobile.ts        # Mobile detection hook
├── package.json
├── next.config.ts
└── tsconfig.json
```

## SDK Usage Examples

### Browser Client (Real-time Subscriptions)

```typescript
import { ironflow } from "@ironflow/browser";

// Configure and connect (typically done in a provider)
ironflow.configure({ serverUrl: "http://localhost:9123" });
await ironflow.connect();

// Subscribe to events
const subscription = await ironflow.subscribe("events:user.created", {
  onEvent: (event) => {
    console.log("Received event:", event);
  },
});

// Cleanup
subscription.unsubscribe();
```

### Node Handler (Serverless Workflows)

```typescript
import { serve, ironflow } from "@ironflow/node";

// Define a workflow function
const processOrder = ironflow.createFunction(
  {
    id: "process-order",
    triggers: [{ event: "order.created" }],
  },
  async ({ event, step }) => {
    const result = await step.run("validate", async () => {
      return { orderId: event.data.orderId, status: "validated" };
    });
    return result;
  }
);

// Create the HTTP handler
const handler = serve({
  functions: [processOrder],
});

export const POST = handler;
```
