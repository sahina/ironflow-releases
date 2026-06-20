/**
 * Compliance Audit Trail Demo Setup
 *
 * Creates an order entity stream with lifecycle events that demonstrate
 * end-to-end audit lineage in the Ironflow dashboard.
 *
 * Usage: pnpm tsx setup.ts
 * Requires: Ironflow server running at localhost:9123
 */

import { createClient } from "@ironflow/node";
import { STREAM_EVENTS } from "./events";

const client = createClient({
  serverUrl: process.env.IRONFLOW_URL ?? "http://localhost:9123",
});

const ENTITY_ID = "order-demo-001";
const ENTITY_TYPE = "order";

const orderLifecycle = [
  {
    name: STREAM_EVENTS.OrderCreated,
    data: {
      order_id: "order-demo-001",
      customer_id: "cust-42",
      items: [
        { sku: "WIDGET-A", quantity: 3, unit_price: 29.99 },
        { sku: "GADGET-B", quantity: 1, unit_price: 149.99 },
      ],
      total: 239.96,
      currency: "USD",
      created_by: "api-key:ak_demo_001",
    },
  },
  {
    name: STREAM_EVENTS.OrderConfirmed,
    data: {
      order_id: "order-demo-001",
      confirmed_by: "payment-service",
      payment_method: "credit_card",
      payment_id: "pay_abc123",
      confirmed_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    },
  },
  {
    name: STREAM_EVENTS.OrderPacked,
    data: {
      order_id: "order-demo-001",
      packed_by: "warehouse-worker-7",
      warehouse: "WH-EAST-01",
      package_weight_kg: 2.3,
      packed_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    },
  },
  {
    name: STREAM_EVENTS.OrderShipped,
    data: {
      order_id: "order-demo-001",
      carrier: "FedEx",
      tracking_number: "FX-789456123",
      estimated_delivery: new Date(
        Date.now() + 3 * 24 * 60 * 60 * 1000,
      ).toISOString(),
      shipped_at: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
    },
  },
  {
    name: STREAM_EVENTS.OrderDelivered,
    data: {
      order_id: "order-demo-001",
      signed_by: "Jane Smith",
      delivery_photo_url: "https://example.com/proof/del-001.jpg",
      delivered_at: new Date().toISOString(),
    },
  },
];

async function main() {
  console.log("Setting up Compliance Audit Trail demo...\n");

  for (let i = 0; i < orderLifecycle.length; i++) {
    const event = orderLifecycle[i];
    try {
      // Seeding is strictly sequential; loop index matches the expected prior version.
      // expectedVersion guards against re-running the script against a stream that
      // already has events — second run fails loudly instead of silently corrupting.
      const evt = { name: event.name, data: event.data, entityType: ENTITY_TYPE };
      const result = await client.streams.append(ENTITY_ID, evt, { expectedVersion: i });
      console.log(
        `  [${i + 1}/${orderLifecycle.length}] ${event.name} → v${result.entityVersion}`,
      );
    } catch (err) {
      console.error(`  Failed to append ${event.name}:`, err);
    }

    // Small delay between events for distinct timestamps
    if (i < orderLifecycle.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  console.log("\nDone! Open http://localhost:9123/compliance-audit");
  console.log(`Select "${ENTITY_ID}" from the left panel to see the audit trail.`);
}

main().catch(console.error);
