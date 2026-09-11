# TypeScript SDK Reference

## Install

```bash
pnpm add @ironflow/node        # Server: functions, workers, projections
pnpm add @ironflow/browser     # Browser: subscriptions, KV, config
```

## Event Name Constants

Use `as const` objects, never raw string literals.

```typescript
// src/events/order-events.ts
export const OrderEvents = {
  PLACED: "order.placed",
  CONFIRMED: "order.confirmed",
  SHIPPED: "order.shipped",
} as const;
export type OrderEventName = (typeof OrderEvents)[keyof typeof OrderEvents];
```

Use everywhere — triggers, projections, emit, waitForEvent, streams.append.

**Exception** — webhook event names are runtime-determined and may use template strings.

## Functions

```typescript
import { createFunction } from "@ironflow/node";
import { OrderEvents } from "../events/order-events";

export const processOrder = createFunction(
  {
    id: "process-order",
    triggers: [{ event: OrderEvents.PLACED }],
    recording: true,             // enable time-travel debugging
  },
  async ({ event, step }) => {
    const order = await step.run("validate", async () => {
      return { valid: true, orderId: (event.data as any).orderId };
    });

    const charge = await step.run("charge", async () => {
      return await stripe.charges.create({
        amount: order.total,
        currency: "usd",
        idempotencyKey: `order-${order.orderId}`,
      });
    });

    return { orderId: order.orderId, charge };
  },
);
```

### Function config (most common fields)

| Field | Purpose |
|---|---|
| `id` | Unique function ID (required) |
| `triggers` | Events that invoke this function (required) |
| `recording` | Enable time-travel debugging |
| `mode` | `"push"` or `"pull"` |
| `secrets` | Secret names to resolve at execution |
| `concurrency` | `{ limit, key }` for rate limiting |
| `retry` | `{ maxAttempts, initialDelayMs, backoffFactor }` |
| `timeout` | Function timeout in ms (default 600000) |
| `schema` | Zod schema for `event.data` validation |
| `debounce` | `{ periodMs, key?, maxWaitMs? }` — collapse event storms (floor 1000ms; async-only) |
| `cancelOn` | `[{ event, match }]` — auto-cancel this run when a matching event arrives |

Trigger entries take more than `event`: `{ event, expression }` filters with CEL, and
`{ event, cron: "0 9 * * *" }` schedules. See `Trigger` in `sdk/js/core/src/types.ts`.

## Emitting Events

`emit` is how anything outside a function starts a workflow. It is fire-and-forget: it
returns as soon as the event is stored and the runs are created.

```typescript
import { createClient } from "@ironflow/node";
const client = createClient();   // reads IRONFLOW_SERVER_URL / IRONFLOW_API_KEY

const { eventId, runIds } = await client.emit(
  OrderEvents.PLACED,
  { orderId: "ord_123", total: 99.99 },
  {
    idempotencyKey: `order-${orderId}`,  // dedupes repeat emits
    version: 1,                          // event schema version, default 1
    metadata: { source: "checkout" },
    namespace: "default",
  },
);

// Block until EVERY run the event triggers finishes. Returns EmitSyncResult[]
// (empty if nothing matched). Never throws on a run outcome — read status,
// error and waitTimedOut per element.
const results = await client.emitSync(OrderEvents.PLACED, data, { timeout: 30000 });

// One function by ID, one result — this one DOES throw RunFailedError /
// RunCancelledError / RunWaitTimeoutError, because there is exactly one run.
const { output } = await client.invoke("process-order", { data, timeout: 30000 });
```

Inside a function handler there is no `client` on the context — import `createClient`
yourself, and do the emit inside a `step.run` so it is memoized.

## Step Methods

```typescript
// Memoized — survives crashes, returns cached result on retry
await step.run("step-name", async () => { /* I/O here */ });

// Durable sleep
await step.sleep("wait", "1h");
await step.sleepUntil("wait-open", "2026-03-16T09:30:00Z");

// Wait for an external event. Returns the matching event — NOT null, and
// NOT a rejection you can catch. On expiry the scheduler marks the step
// timed_out and fails the run (internal/engine/scheduler.go:428,451); your
// handler is never resumed, so no code after this line runs.
const approval = await step.waitForEvent("wait-approval", {
  event: OrderEvents.APPROVED,
  match: "data.orderId",         // full path including "data."
  timeout: "24h",                // default "7d"
});

// Parallel branches
const [a, b] = await step.parallel("fetch-all", [
  async (s) => s.run("fetch-a", () => fetchA()),
  async (s) => s.run("fetch-b", () => fetchB()),
]);

// Parallel map with concurrency
const results = await step.map("items", items, async (item, s, i) => {
  return s.run(`process-${i}`, () => processItem(item));
}, { concurrency: 5 });

// Saga compensation
await step.run("charge", () => charge());
step.compensate("charge", () => refund());

// Invoke another function
const result = await step.invoke<R>("other-fn", input);
const { runId } = await step.invokeAsync("other-fn", input);

// Pub/sub publish (does NOT trigger functions)
await step.publish("notifications", { type: "order.shipped" });

// Secrets live on the function context, not on step. Synchronous; throws if unset.
const stripeKey = ctx.secrets.get("stripe-key");
```

### Yielding steps: never catch their rejection

`sleep`, `sleepUntil`, `waitForEvent`, `invoke` and `invokeAsync` suspend the run by
**throwing an internal `YieldSignal`** (`sdk/js/node/src/step.ts`). The SDK catches it at
the handler boundary and reports `status: "yielded"` (`sdk/js/node/src/serve.ts:398`).

```typescript
// WRONG — the catch swallows the YieldSignal. The run never suspends;
// it "completes" immediately and the wait silently never happens.
try {
  const approval = await step.waitForEvent("wait", { ... });
} catch {
  return { status: "cancelled" };
}

// EQUALLY WRONG — a chained .catch() swallows the same signal.
await step.sleep("cool-off", "1h").catch(() => undefined);
```

To branch on a deadline, model the deadline as an event and race it:

```typescript
// A sibling function sleeps and emits order.approval_timeout.
await step.invokeAsync("order-approval-deadline", { orderId });

const settled = await step.waitForEvent("await-settlement", {
  event: OrderEvents.SETTLED,   // emitted by the approval path OR the deadline path
  match: "data.orderId",
  timeout: "48h",               // hard ceiling: if THIS fires, the run fails
});
```

If a hard failure is acceptable, let the timeout fire and react from a separate
listener on `system.run.*.failed`.

`step.run` is the exception — it runs your callback inline, so errors from it are
ordinary catchable errors.

## Projections

```typescript
import { createProjection } from "@ironflow/node";

// Managed: pure reducer, Ironflow stores state
const orderStats = createProjection({
  name: "order-stats",
  events: [OrderEvents.PLACED],
  initialState: () => ({ totalOrders: 0, revenue: 0 }),  // function, not object
  handler: (state, event) => ({
    totalOrders: state.totalOrders + 1,
    revenue: state.revenue + ((event.data as any).total ?? 0),
  }),
});

// External: side effects allowed, you manage storage
const syncToDb = createProjection({
  name: "sync-orders-db",
  events: [OrderEvents.PLACED],
  mode: "external",
  handler: async (event) => {
    await db.insert("orders", event.data);
  },
});
```

## Worker (Pull Mode)

```typescript
import { createWorker, type IronflowProjection } from "@ironflow/node";

const worker = createWorker({
  serverUrl: process.env.IRONFLOW_SERVER_URL || "http://localhost:9123",
  functions: [processOrder],
  projections: [orderStats as IronflowProjection],   // cast required
});

// start() registers every function, then polls forever — it NEVER resolves.
// Anything written after this line is dead code. Do setup before it.
await worker.start();
```

Subpath exports are public API: `@ironflow/node/worker`, `/serve`, `/agent`,
`/worker-streaming` (opt-in ConnectRPC streaming worker) and `/test` (test harness).

## Serve (Push Mode — Next.js App Router)

```typescript
// app/api/ironflow/route.ts
import { serve, createClient } from "@ironflow/node";

export const POST = serve({ functions: [processOrder] });

// GET = registration (call once after deploy)
export async function GET() {
  const client = createClient({
    serverUrl: process.env.IRONFLOW_SERVER_URL!,
    apiKey: process.env.IRONFLOW_API_KEY,
  });
  await client.registerFunction({
    id: processOrder.config.id,
    triggers: processOrder.config.triggers,
    endpointUrl: `${process.env.NEXT_PUBLIC_URL}/api/ironflow`,
  });
  return Response.json({ registered: true });
}
```

## Browser SDK

```typescript
import { ironflow } from "@ironflow/browser";

ironflow.configure({ serverUrl: process.env.NEXT_PUBLIC_IRONFLOW_URL! });
await ironflow.connect();   // for real-time

// One-time read
const result = await ironflow.getProjection<MyState>("order-stats");

// Real-time — server pushes full state on save (NEVER poll)
const sub = await ironflow.subscribeToProjection<MyState>("order-stats", {
  onUpdate: (state) => setState(state),
});
sub.unsubscribe();
```

### Offline writes

Opt in with `createClient` when the app must keep working without a network. Writes go to IndexedDB first and drain in FIFO; the singleton `ironflow` is unaffected.

```typescript
import { createClient } from "@ironflow/browser";

const app = await createClient({
  serverUrl: process.env.NEXT_PUBLIC_IRONFLOW_URL!,
  offlineQueue: { identity: currentUser.id },   // identity is required
});

const { localId, pending } = await app.emit("order.approved", { orderId: "123" });
app.queue.watch(localId, (s) => s.status === "sent" && markDelivered());
app.queue.subscribe(({ pending }) => setBadge(pending));

app.client.subscribe(...);   // everything else lives on .client
```

Queued `emit` returns no `runIds`, and a queued `streams.append` rejects `expectedVersion` unless it is `-1`. If you pass `onAuthRequired`, return `identity` from it too, not just the credential — that is what rebinds the queue when a different user signs in. Nothing drains while the page is closed — this is an outbox, not background sync.

## Entity Streams

`getInfo` returns `null` when the stream has no events yet — `expectedVersion: 0` is
safe for the first append in that case.

Entity IDs must be URL-safe: letters, digits, `-`, `_`, `.`, `:`, `~`. `/`, `?`, `#`, `%`,
`&`, and whitespace are rejected at write time. To namespace by tenant, flatten into one
segment (`${tenantId}-issue-${issueId}`) or filter by `entityType` instead of embedding
the namespace in the ID.

```typescript
import { createClient } from "@ironflow/node";
const client = createClient();

const info = await client.streams.getInfo("order-123");
await client.streams.append("order-123", {
  name: OrderEvents.PLACED,
  data: { total: 99.99 },
  entityType: "order",
}, { expectedVersion: info ? info.version : 0 });

// read returns { events, totalCount } — not a bare array.
const { events, totalCount } = await client.streams.read("order-123");
```

`append` takes **exactly one** event per call, not an array. It returns
`{ entityVersion, eventId }` and no sequence number.

## KV Store

```typescript
const client = createClient();
const kv = client.kv();                      // kv() is a METHOD, not a property
await kv.createBucket({ name: "user-settings" });   // stored as APP_user-settings

const bucket = kv.bucket("user-settings");
await bucket.put("user-123", { theme: "dark" });
try {
  const entry = await bucket.get("user-123");
} catch { /* missing key */ }
await bucket.create("user-456", { theme: "light" });        // create-if-not-exists
await bucket.update("user-123", { theme: "light" }, entry.revision);  // CAS
const keys = await bucket.listKeys();                        // string[]; optional filter arg
await bucket.delete("user-123");
```

**Watch is available in both `@ironflow/node` and `@ironflow/browser`** — the reads and
writes above are REST, but `watch` upgrades to a WebSocket. The callback takes one event
object, not `(key, value)`:

```typescript
const watcher = bucket.watch(
  { onUpdate: (e) => console.log(e.key, e.value, e.operation), onError: (err) => {} },
  { key: "user.*" },                    // optional key pattern
);
watcher.stop();   // ALWAYS clean up
```

## Config Client

```typescript
const client = createClient();
const config = client.config();              // config() is a METHOD, not a property
await config.set("flags", { darkMode: true });
const cfg = await config.get("flags");
await config.patch("flags", { betaFeatures: true });

const watcher = config.watch("flags", {
  onUpdate: (data) => console.log(data),
});
watcher.stop();
```

## Webhooks

```typescript
import { createWebhook, serve } from "@ironflow/node";

const stripe = createWebhook({
  id: "stripe",
  verify: async (req) => {
    const sig = req.headers["stripe-signature"];
    return stripeSdk.webhooks.constructEvent(req.body, sig, process.env.STRIPE_SECRET!);
  },
  transform: (payload) => ({
    name: `webhook/stripe.${payload.type}`,
    data: payload.data.object,
  }),
});

export const POST = serve({ functions: [...], webhooks: [stripe] });
// Endpoint: POST /webhooks/stripe
```

## Errors

```typescript
import { NonRetryableError } from "@ironflow/node";

throw new NonRetryableError("Invalid email");   // fails immediately
throw new Error("Gateway timeout");              // retried per retry config
```

## Upcasters (Event Schema Versioning)

Upcasters reach the runtime through `eventDefinitions` — one `defineEvent` per version.
The registry wires each version's `upcast` as `version-1 → version` automatically (and
ignores `upcast` on version 1).

```typescript
import { defineEvent, createEventDefinitionRegistry } from "@ironflow/core";
import { createWorker } from "@ironflow/node";

const events = createEventDefinitionRegistry();
events.register(defineEvent({ name: "user.created", version: 1 }));
events.register(defineEvent({
  name: "user.created",
  version: 2,
  upcast: (data) => {
    const { firstName, lastName, ...rest } = data as Record<string, unknown>;
    return { ...rest, fullName: `${firstName} ${lastName}` };  // ALWAYS spread rest
  },
}));

const worker = createWorker({ functions: [...], eventDefinitions: events });
```

`serve({ functions, eventDefinitions })` takes the same option for push mode.

There is also a lower-level `createUpcasterRegistry()` in `@ironflow/core` (the
`UpcasterRegistry` class itself is NOT exported), but **nothing accepts it as config** —
it only supports manual `.upcast(...)` calls where you read events:

```typescript
const current = registry.upcast("user.created", event.data, event.version, 2);
```

Chain sequentially (v1→v2→v3, never skip). Always spread `...rest` to preserve fields.
Projections do **not** upcast — `eventDefinitions` is never plumbed into the projection
runner, so handlers see raw stored data at whatever version it was written.

---

## Full Reference

For complete API surface, advanced options, and edge cases:

- TypeScript SDK reference: https://docs.ironflow.run/reference/js-sdk/
- Node SDK package: https://docs.ironflow.run/reference/js-sdk/node/
- Browser SDK package: https://docs.ironflow.run/reference/js-sdk/browser/
- Workflows guide: https://docs.ironflow.run/explanation/workflows/
- Event sourcing: https://docs.ironflow.run/explanation/event-sourcing/
- KV store: https://docs.ironflow.run/explanation/kv-store/
- Secrets management: https://docs.ironflow.run/explanation/secrets-management/
- Config management: https://docs.ironflow.run/explanation/config-management/
