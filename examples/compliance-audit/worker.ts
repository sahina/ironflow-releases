/**
 * Compliance Audit Trail Demo Worker
 *
 * Registers functions that process order lifecycle events.
 * These functions demonstrate durable execution proof in the compliance dashboard.
 */

import { createFunction, createWorker } from "@ironflow/node";
import { EVENTS } from "./events";

// Audit retention is global: set IRONFLOW_AUDIT_RETENTION_DAYS on the server
// to match your compliance window (a trail like this often needs years).

const processOrderCreated = createFunction(
  {
    id: "process-order-created",
    description: "Validates a newly created order and reserves inventory. Each step is permanently recorded for compliance audit trails.",
    triggers: [{ event: EVENTS.OrderCreated }],
    recording: true,
  },
  async ({ event, step }) => {
    const validation = await step.run("validate-order", async () => {
      const data = event.data as Record<string, unknown>;
      return {
        valid: true,
        items_count: (data.items as unknown[])?.length ?? 0,
        total: data.total,
      };
    });

    await step.run("reserve-inventory", async () => {
      return { reserved: true, warehouse: "WH-EAST-01" };
    });

    return { status: "processed", validation };
  },
);

const processOrderShipped = createFunction(
  {
    id: "process-order-shipped",
    description: "Sends a shipping notification and updates order tracking when an order ships. Each step is permanently recorded for compliance audit trails.",
    triggers: [{ event: EVENTS.OrderShipped }],
    recording: true,
  },
  async ({ event, step }) => {
    await step.run("notify-customer", async () => {
      const data = event.data as Record<string, unknown>;
      return {
        notified: true,
        channel: "email",
        tracking_number: data.tracking_number,
      };
    });

    await step.run("update-tracking", async () => {
      return { tracking_updated: true };
    });

    return { status: "shipping-processed" };
  },
);

const worker = createWorker({
  functions: [processOrderCreated, processOrderShipped],
});

worker.start().then(() => {
  console.log("Compliance audit demo worker started");
});
