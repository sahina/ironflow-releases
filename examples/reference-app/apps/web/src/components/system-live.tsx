"use client";

import { System } from "@/components/system";
import { useOrders } from "@/lib/use-orders";

/**
 * `/system`, with the browser row telling the truth.
 *
 * The status hook can poll the engine, but it cannot observe a projection
 * subscription it does not hold — so this page opens its own, and reports on
 * that. Anything else would claim the read model works on the strength of a
 * health check that says nothing about it.
 *
 * Three states, not two: `undefined` until the first answer arrives. "Running"
 * before anything has been delivered is exactly the overclaim this page exists
 * to avoid making about the other four processes.
 */
export function SystemLive({ session, dashboardUrl }: { session: string; dashboardUrl: string }) {
  const { error, ready } = useOrders(session);
  return (
    <System
      dashboardUrl={dashboardUrl}
      readModelConnected={error !== undefined ? false : ready ? true : undefined}
    />
  );
}
