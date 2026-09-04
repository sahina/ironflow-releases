// Links from this UI into the Ironflow dashboard.
//
// The reference app does not rebuild a run inspector; it points at the one the
// engine already serves on the same discovered port.

import { paymentStreamId, orderStreamId } from "@/lib/contracts";

const trimmed = (baseUrl: string) => baseUrl.replace(/\/+$/, "");

export function dashboardRunUrl(baseUrl: string, runId: string): string {
  return `${trimmed(baseUrl)}/runs/${runId}`;
}

/**
 * One of this order's two entity streams. Ordering owns `order-{id}` and
 * Payments owns `payment-{id}`; the naming rule for each lives beside the
 * service that writes it, and `lib/contracts.ts` holds the browser's copy.
 */
export function dashboardStreamUrl(
  baseUrl: string,
  orderId: string,
  stream: "order" | "payment",
): string {
  const entityId = stream === "order" ? orderStreamId(orderId) : paymentStreamId(orderId);
  return `${trimmed(baseUrl)}/streams/${entityId}`;
}
