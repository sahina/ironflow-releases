import type { PlaceOrderCommand } from "../lib/types";

export function crashCommand(orderId: string, commandId: string): PlaceOrderCommand {
  return {
    data: {
      orderId, customerId: "cust-001", items: [{ productId: "prod-widget", qty: 1 }],
      shippingAddress: { street: "1 Main St", city: "Boston", zip: "02101", country: "US" },
    },
    metadata: { commandId, issuedAt: "2026-10-11T12:00:00Z", issuedBy: "crash-test" },
  };
}
