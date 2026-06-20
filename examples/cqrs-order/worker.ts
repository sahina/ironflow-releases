// Walkthrough Step 8 — worker that runs the projections AND hosts the
// place-order command handler. Start with: pnpm worker
//
// Why a function here? The Ironflow server requires at least one function per
// registered worker. We host `place-order` as a function triggered by
// `create.order`; the Next.js API route emits that event (Step 2). The handler
// body in `lib/place-order-handler.ts` still shows the direct CQRS flow.

import {
  createFunction,
  createProjection,
  createWorker,
  type IronflowProjection,
} from "@ironflow/node";
import { placeOrderHandler } from "./lib/place-order-handler";
import { EVENTS, STREAM_EVENTS } from "./lib/events";
import type {
  CustomerOrdersListState,
  OrderDetailViewState,
  OrderDetail,
  OrderSummary,
  PlaceOrderCommand,
} from "./lib/types";

// ─── Command handler: place-order ───────────────────────────────

const placeOrder = createFunction(
  {
    id: "place-order",
    description:
      "CQRS command handler. Runs placeOrderHandler (dedup, enrich, load, decide, append) when a create.order event is emitted.",
    triggers: [{ event: EVENTS.CreateOrder }],
    recording: true,
  },
  async ({ event, step }) => {
    const cmd = event.data as PlaceOrderCommand;
    // Wrap the handler in a step so retries are memoized at the boundary.
    return await step.run("handle-place-order", async () => {
      return await placeOrderHandler(cmd);
    });
  },
);

// ─── OrderDetailView — per-order managed projection ─────────────

// Pure-reducer style — return a new state object for every event. Matches
// the immutable update pattern shown in docs/explanation/ddd/cqrs.md.
const orderDetail = createProjection<OrderDetailViewState>({
  name: "order-detail-view",
  events: [STREAM_EVENTS.OrderPlaced, STREAM_EVENTS.OrderShipped, STREAM_EVENTS.OrderCancelled],
  initialState: () => ({ orders: {} as Record<string, OrderDetail> }),
  handler: (state, event, ctx) => {
    const data = event.data as Record<string, unknown>;
    const orderId = data.orderId as string;
    const ts = ctx.event.timestamp.toISOString();
    const existing = state.orders[orderId];

    switch (event.name) {
      case STREAM_EVENTS.OrderPlaced: {
        const customer = data.customer as {
          id: string;
          name: string;
          email: string;
        };
        return {
          ...state,
          orders: {
            ...state.orders,
            [orderId]: {
              orderId,
              customerId: customer.id,
              customerName: customer.name,
              customerEmail: customer.email,
              items: data.items as OrderDetail["items"],
              shippingAddress: data.shippingAddress as OrderDetail["shippingAddress"],
              totalAmount: data.totalAmount as number,
              status: "placed",
              placedAt: ts,
            },
          },
        };
      }
      case STREAM_EVENTS.OrderShipped:
        return existing
          ? {
              ...state,
              orders: {
                ...state.orders,
                [orderId]: {
                  ...existing,
                  status: "shipped",
                  trackingNumber: data.trackingNumber as string,
                  shippedAt: ts,
                },
              },
            }
          : state;
      case STREAM_EVENTS.OrderCancelled:
        return existing
          ? {
              ...state,
              orders: {
                ...state.orders,
                [orderId]: {
                  ...existing,
                  status: "cancelled",
                  cancelledAt: ts,
                  cancellationReason: data.reason as string,
                },
              },
            }
          : state;
      default:
        return state;
    }
  },
});

// ─── CustomerOrdersList — partitioned projection ────────────────

const customerOrders = createProjection<CustomerOrdersListState>({
  name: "customer-orders-list",
  events: [STREAM_EVENTS.OrderPlaced, STREAM_EVENTS.OrderShipped, STREAM_EVENTS.OrderCancelled],
  partitionKey: "$.data.customer.id",
  initialState: () => ({ orders: [] as OrderSummary[] }),
  handler: (state, event, ctx) => {
    const data = event.data as Record<string, unknown>;
    const orderId = data.orderId as string;

    if (event.name === STREAM_EVENTS.OrderPlaced) {
      const items = data.items as { name: string }[];
      return {
        ...state,
        orders: [
          {
            orderId,
            placedAt: ctx.event.timestamp.toISOString(),
            totalAmount: data.totalAmount as number,
            status: "placed",
            summary:
              items.length === 1
                ? items[0].name
                : `${items.length} items (${items[0].name}…)`,
          },
          ...state.orders,
        ],
      };
    }

    const nextStatus = event.name.split(".")[1];
    return {
      ...state,
      orders: state.orders.map((o) =>
        o.orderId === orderId ? { ...o, status: nextStatus } : o,
      ),
    };
  },
});

// ─── Worker ─────────────────────────────────────────────────────

const worker = createWorker({
  serverUrl: process.env.IRONFLOW_SERVER_URL || "http://localhost:9123",
  functions: [placeOrder],
  projections: [orderDetail, customerOrders] as IronflowProjection[],
});

worker.start().then(() => {
  console.log("CQRS walkthrough worker started");
  console.log("  Functions:");
  console.log("    - place-order              (triggered by create.order)");
  console.log("  Projections:");
  console.log("    - order-detail-view        (per-order, non-partitioned)");
  console.log("    - customer-orders-list     (partitioned by customer.id)");
});
