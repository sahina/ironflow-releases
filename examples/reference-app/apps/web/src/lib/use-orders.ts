"use client";

import { useEffect, useState } from "react";

import { useIronflow } from "@/components/ironflow-provider";
import { type OrdersProjection, type ProjectedOrder, ordersForSession } from "@/lib/orders";

/**
 * This session's orders, live.
 *
 * Reads the managed projection once, then follows it. Nothing here folds a raw
 * stream: order state belongs to the ordering service, and the browser renders
 * the read model it publishes. `error` is set when the engine cannot be reached.
 */
export function useOrders(session: string): {
  orders: ProjectedOrder[];
  error?: string;
  /**
   * Whether the read model has actually answered. `error === undefined` is not
   * the same claim: it is also true before the first reply, which would let
   * /system report the subscription as working before it had delivered
   * anything.
   */
  ready: boolean;
} {
  const ironflow = useIronflow();
  const [orders, setOrders] = useState<ProjectedOrder[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let live = true;
    const show = (state: OrdersProjection) => {
      if (!live) return;
      setOrders(ordersForSession(state, session));
      setReady(true);
      setError(undefined);
    };

    // An unreachable engine has to say so: an empty read model and a dead
    // server render identically otherwise.
    void ironflow.getOrders().then(show, (cause: unknown) => {
      if (live) setError(cause instanceof Error ? cause.message : String(cause));
    });
    // Kept as a promise, and unsubscribed only once it resolves: tearing down a
    // subscription that is still connecting is what raises "canceled before
    // connect completed".
    const subscription = ironflow.subscribeToOrders(show).catch((cause: unknown) => {
      if (live) setError(cause instanceof Error ? cause.message : String(cause));
      return undefined;
    });

    return () => {
      live = false;
      void subscription.then((handle) => handle?.unsubscribe());
    };
  }, [ironflow, session]);

  return { orders, error, ready };
}
