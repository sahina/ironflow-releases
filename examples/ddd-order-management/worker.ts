import {
  createFunction,
  createProjection,
  createWorker,
  createClient,
  NonRetryableError,
  type IronflowProjection,
} from "@ironflow/node";
import { EVENTS, STREAM_EVENTS } from "./events";

const ironflow = createClient();

// ─── DOMAIN EVENTS ──────────────────────────────────────────────
// Events are past-tense facts recorded in entity streams.

interface OrderPlacedData {
  orderId: string;
  customerId: string;
  items: Array<{ sku: string; qty: number; price: number }>;
  total: number;
}

interface OrderConfirmedData {
  orderId: string;
  transactionId: string;
  confirmedAt: string;
}

interface OrderShippedData {
  orderId: string;
  trackingNumber: string;
  shippedAt: string;
}

interface OrderCancelledData {
  orderId: string;
  reason: string;
  cancelledAt: string;
}

// ─── COMMAND HANDLER: place-order ───────────────────────────────
// Triggered by: create.order (command — imperative, expresses intent)
// Produces: order.placed (domain event — past tense, recorded fact)
// DDD: Aggregate — reads entity stream, validates invariants, appends event
const placeOrder = createFunction(
  {
    id: "place-order",
    description: "DDD aggregate handler. Validates order invariants, guards against duplicate orders via entity stream lookup, then appends an order.placed domain event.",
    triggers: [{ event: EVENTS.CreateOrder }],
    recording: true,
  },
  async ({ event, step }) => {
    if (
      typeof event.data !== "object" ||
      event.data === null ||
      Array.isArray(event.data)
    ) {
      throw new NonRetryableError(
        "Invalid event data: expected a plain object",
      );
    }
    const data = event.data as OrderPlacedData;
    const streamId = `order-${data.orderId}`;

    // Validate invariants (aggregate guard)
    await step.run("validate-order", async () => {
      // Validation failures are terminal — retrying won't fix an empty cart or
      // negative total. NonRetryableError signals the engine to skip the retry
      // schedule and fail the run immediately.
      if (!data.items || data.items.length === 0) {
        throw new NonRetryableError("Order must have at least one item");
      }
      if (data.total <= 0) {
        throw new NonRetryableError("Order total must be positive");
      }

      // Check the entity stream — can't place an order that already exists
      const info = await ironflow.streams.getInfo(streamId);
      if (info) {
        throw new NonRetryableError(`Order ${data.orderId} already exists`);
      }

      return { valid: true };
    });

    // Append domain event to entity stream.
    // expectedVersion: 0 = assert stream is new. Paired with the getInfo guard above,
    // this closes the TOCTOU race where two concurrent create.order commands with the
    // same orderId both pass the guard, then both try to append. The second append
    // fails with a version conflict instead of corrupting the aggregate.
    const result = await step.run("record-order-placed", async () => {
      const orderPlaced = {
        entityType: "order",
        name: STREAM_EVENTS.OrderPlaced,
        data: {
          orderId: data.orderId,
          customerId: data.customerId,
          items: data.items,
          total: data.total,
        },
      };
      return await ironflow.streams.append(streamId, orderPlaced, { expectedVersion: 0 });
    });

    return { orderId: data.orderId, streamId, version: result.entityVersion };
  },
);

// ─── COMMAND HANDLER: fulfill-order (SAGA) ──────────────────────
// Triggered by: order.placed (domain event)
// DDD: Saga — multi-step with compensation
const fulfillOrder = createFunction(
  {
    id: "fulfill-order",
    description: "DDD saga that fulfills a placed order: confirms payment, ships the order, and publishes a notification event. Each step registers a compensation handler for automatic rollback on failure.",
    triggers: [{ event: STREAM_EVENTS.OrderPlaced }],
    recording: true,
  },
  async ({ event, step }) => {
    const data = event.data as OrderPlacedData;
    const streamId = `order-${data.orderId}`;

    // Step 1: Confirm payment + compensate.
    // Load current entity version, thread it through saga state. Each append returns
    // result.entityVersion which the next step/compensation uses as its expectedVersion.
    // If anything appends to this stream between steps (concurrent command, operator
    // tool, etc.), the version conflict prevents the saga from writing over it.
    const payment = await step.run("confirm-payment", async () => {
      const info = await ironflow.streams.getInfo(streamId);
      // The saga fires on order.placed, so the stream must already exist.
      // A missing stream means the event history was lost — fail loudly
      // instead of masking the inconsistency by starting a new stream.
      if (!info) {
        throw new NonRetryableError(`Aggregate invariant violated: order stream ${streamId} missing when fulfilling`);
      }
      const expectedVersion = info.version;
      const transactionId = `txn_${Date.now()}`;
      const confirmed = {
        entityType: "order",
        name: STREAM_EVENTS.OrderConfirmed,
        data: {
          orderId: data.orderId,
          transactionId,
          confirmedAt: new Date().toISOString(),
        } satisfies OrderConfirmedData,
      };
      const result = await ironflow.streams.append(streamId, confirmed, { expectedVersion });
      return { transactionId, entityVersion: result.entityVersion };
    });

    step.compensate("confirm-payment", async () => {
      console.log(
        `Reversing payment ${payment.transactionId} for order ${data.orderId}`,
      );
      // Compensation runs after other saga steps may have advanced the version.
      // Re-load to get current head rather than reusing payment.entityVersion.
      const info = await ironflow.streams.getInfo(streamId);
      if (!info) {
        throw new NonRetryableError(`Aggregate invariant violated: order stream ${streamId} missing during compensation`);
      }
      const expectedVersion = info.version;
      const cancelled = {
        entityType: "order",
        name: STREAM_EVENTS.OrderCancelled,
        data: {
          orderId: data.orderId,
          reason: "Payment reversal — saga compensation",
          cancelledAt: new Date().toISOString(),
        } satisfies OrderCancelledData,
      };
      await ironflow.streams.append(streamId, cancelled, { expectedVersion });
    });

    // Step 2: Ship order + compensate.
    // Uses payment.entityVersion from step 1 — no re-load needed inside the happy path
    // because step.run memoizes and the saga is sequential.
    const shipment = await step.run("ship-order", async () => {
      const trackingNumber = `TRACK_${data.orderId}`;
      const shipped = {
        entityType: "order",
        name: STREAM_EVENTS.OrderShipped,
        data: {
          orderId: data.orderId,
          trackingNumber,
          shippedAt: new Date().toISOString(),
        } satisfies OrderShippedData,
      };
      const result = await ironflow.streams.append(streamId, shipped, {
        expectedVersion: payment.entityVersion,
      });
      return { trackingNumber, entityVersion: result.entityVersion };
    });

    step.compensate("ship-order", async () => {
      console.log(`Cancelling shipment for order ${data.orderId}`);
    });

    // Publish integration event
    await step.publish(EVENTS.NotificationsOrderShipped, {
      orderId: data.orderId,
      trackingNumber: shipment.trackingNumber,
    });

    return {
      orderId: data.orderId,
      transactionId: payment.transactionId,
      trackingNumber: shipment.trackingNumber,
    };
  },
);

// ─── PROJECTION: order-summary (per-order read model) ───────────
// DDD: CQRS Read Model — per-order state via partition key

interface OrderSummaryState {
  orderId: string;
  customerId: string;
  items: Array<{ sku: string; qty: number; price: number }>;
  total: number;
  status: string;
  transactionId: string | null;
  trackingNumber: string | null;
}

interface OrderDashboardState {
  totalOrders: number;
  totalRevenue: number;
  byStatus: { placed: number; confirmed: number; shipped: number; cancelled: number };
}

const orderSummary = createProjection<OrderSummaryState>({
  name: "order-summary",
  events: [
    STREAM_EVENTS.OrderPlaced,
    STREAM_EVENTS.OrderConfirmed,
    STREAM_EVENTS.OrderShipped,
    STREAM_EVENTS.OrderCancelled,
  ],
  partitionKey: "$.data.orderId",
  initialState: () => ({
    orderId: "",
    customerId: "",
    items: [] as Array<{ sku: string; qty: number; price: number }>,
    total: 0,
    status: "unknown",
    transactionId: null as string | null,
    trackingNumber: null as string | null,
  }),
  handler: (state: OrderSummaryState, event: { name: string; data: unknown }) => {
    const data = event.data as Record<string, unknown>;
    switch (event.name) {
      case STREAM_EVENTS.OrderPlaced:
        return {
          ...state,
          orderId: data.orderId as string,
          customerId: data.customerId as string,
          items: data.items as Array<{
            sku: string;
            qty: number;
            price: number;
          }>,
          total: data.total as number,
          status: "placed",
        };
      case STREAM_EVENTS.OrderConfirmed:
        return {
          ...state,
          status: "confirmed",
          transactionId: data.transactionId as string,
        };
      case STREAM_EVENTS.OrderShipped:
        return {
          ...state,
          status: "shipped",
          trackingNumber: data.trackingNumber as string,
        };
      case STREAM_EVENTS.OrderCancelled:
        return { ...state, status: "cancelled" };
      default:
        return state;
    }
  },
});

// ─── PROJECTION: order-dashboard (aggregate statistics) ─────────
const orderDashboard = createProjection<OrderDashboardState>({
  name: "order-dashboard",
  events: [
    STREAM_EVENTS.OrderPlaced,
    STREAM_EVENTS.OrderConfirmed,
    STREAM_EVENTS.OrderShipped,
    STREAM_EVENTS.OrderCancelled,
  ],
  initialState: () => ({
    totalOrders: 0,
    totalRevenue: 0,
    byStatus: { placed: 0, confirmed: 0, shipped: 0, cancelled: 0 },
  }),
  handler: (state: OrderDashboardState, event: { name: string; data: unknown }) => {
    const data = event.data as Record<string, unknown>;
    switch (event.name) {
      case STREAM_EVENTS.OrderPlaced:
        return {
          ...state,
          totalOrders: state.totalOrders + 1,
          totalRevenue: state.totalRevenue + ((data.total as number) ?? 0),
          byStatus: {
            ...state.byStatus,
            placed: state.byStatus.placed + 1,
          },
        };
      case STREAM_EVENTS.OrderConfirmed:
        return {
          ...state,
          byStatus: {
            ...state.byStatus,
            placed: state.byStatus.placed - 1,
            confirmed: state.byStatus.confirmed + 1,
          },
        };
      case STREAM_EVENTS.OrderShipped:
        return {
          ...state,
          byStatus: {
            ...state.byStatus,
            confirmed: state.byStatus.confirmed - 1,
            shipped: state.byStatus.shipped + 1,
          },
        };
      case STREAM_EVENTS.OrderCancelled:
        return {
          ...state,
          byStatus: {
            ...state.byStatus,
            confirmed: Math.max(0, state.byStatus.confirmed - 1),
            cancelled: state.byStatus.cancelled + 1,
          },
        };
      default:
        return state;
    }
  },
});

// ─── WORKER ─────────────────────────────────────────────────────
const worker = createWorker({
  functions: [placeOrder, fulfillOrder],
  projections: [orderSummary, orderDashboard] as IronflowProjection[],
});

worker.start().then(() => {
  console.log("DDD Order Management worker started");
  console.log("  Commands:    create.order");
  console.log("  Functions:   place-order, fulfill-order (saga)");
  console.log("  Projections: order-summary, order-dashboard");
});
