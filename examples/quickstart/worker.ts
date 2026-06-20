import {
  createFunction,
  createProjection,
  createWorker,
  type IronflowProjection,
} from "@ironflow/node";
import { EVENTS } from "./events";

// ── Types ───────────────────────────────────────────────────────
interface OrderData {
  orderId: string;
  total: number;
  email: string;
}

// ── React: A function that processes orders ─────────────────────
// Every step is memoized and permanently recorded.
// If the process crashes, it resumes from the last completed step.
const processOrder = createFunction(
  {
    id: "process-order",
    description: "Validates an order, charges payment, and sends a confirmation email in three durable steps. Resumes from the last completed step if interrupted.",
    triggers: [{ event: EVENTS.OrderPlaced }],
    recording: true, // Enable audit recording (powers time-travel debugging)
  },
  async ({ event, step }) => {
    const data = event.data as OrderData;

    const order = await step.run("validate-order", async () => {
      return {
        valid: true,
        orderId: data.orderId,
        total: data.total,
      };
    });

    const payment = await step.run("process-payment", async () => {
      return {
        charged: true,
        amount: order.total,
        transactionId: `txn_${Date.now()}`,
      };
    });

    await step.run("send-confirmation", async () => {
      return { sent: true, email: data.email };
    });

    return { order, payment };
  },
);

// ── Derive: A projection that computes order statistics ─────────
// Projections are pure reducers that build read models from events.
// State is automatically persisted and queryable via the API.
const orderStats = createProjection({
  name: "order-stats",
  events: [EVENTS.OrderPlaced],
  initialState: () => ({ totalOrders: 0, totalRevenue: 0 }),
  handler: (
    state: { totalOrders: number; totalRevenue: number },
    event: { name: string; data: unknown },
  ) => ({
    totalOrders: state.totalOrders + 1,
    totalRevenue: state.totalRevenue + ((event.data as OrderData).total ?? 0),
  }),
});

// ── Start the worker ────────────────────────────────────────────
// Functions and projections run together in one process.
const worker = createWorker({
  functions: [processOrder],
  projections: [orderStats as IronflowProjection],
});

worker.start().then(() => {
  console.log("✓ Worker started — listening for events");
  console.log("  Functions:   process-order");
  console.log("  Projections: order-stats");
});
