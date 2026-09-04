"use client";

// The real client behind the port in lib/client.ts. Everything Ironflow-shaped
// lives here; components never import the SDK.

import { ironflow } from "@ironflow/browser";

import type { IronflowClient } from "@/lib/client";
import { HEARTBEAT_BUCKET, NOTIFICATIONS_HEARTBEAT_KEY } from "@/lib/heartbeat";
import type { OrdersProjection } from "@/lib/orders";

// Must match `order.ProjectionName` in
// services/orders-go/internal/order/projection.go — the Go service registers the
// projection under this name. Nothing enforces the pair, and a rename on one
// side alone reads as an empty projection with no error.
export const ORDERS_PROJECTION = "orders";

/**
 * How far back a timeline looks for the run behind a fact.
 *
 * A window, not the whole history. An older order's facts fall out of it and
 * simply render no link, which is the honest outcome — this application does
 * not rebuild the dashboard's run inspector.
 */
const RECENT_RUNS = 100;

/**
 * Configures the browser SDK and returns the port the components use.
 *
 * The credential is the engine's development bootstrap key, handed to the page
 * by the Next server. That is a deliberate local-demo choice — the plan for
 * this example calls it out and the UI labels it — and it is not a production
 * pattern: a real application never puts an admin credential in a browser.
 */
// configure() tears the client down — transport, every open subscription, the
// drainer mid-flight — so calling it twice with the same settings kills the
// subscription the previous render opened. React mounts effects twice in
// development, which makes that a guaranteed "subscription canceled before
// connect completed" and a UI that never updates.
let configuredFor: string | undefined;

// One subscription for the whole page, fanned out to every listener.
//
// The SDK shares one consumer per pattern, so unsubscribing tears down the
// consumer any other component on that pattern is using. React mounts effects
// twice in development, and /shop and /operations both subscribe, so a
// per-component subscription leaves a page whose read model never updates
// again — the failure that looks like "the engine stopped publishing".
const listeners = new Set<(state: OrdersProjection) => void>();
let shared: Promise<{ unsubscribe(): void }> | undefined;

export function browserIronflow({ serverUrl, apiKey }: { serverUrl: string; apiKey: string }): IronflowClient {
  const settings = `${serverUrl}|${apiKey}`;
  if (configuredFor !== settings) {
    ironflow.configure({ serverUrl, auth: { apiKey }, logger: false });
    configuredFor = settings;
  }

  return {
    async emit(event, data, metadata) {
      const result = await ironflow.emit(event, data, { metadata });
      return { eventId: result.eventId ?? "", runIds: result.runIds ?? [] };
    },
    async listWorkers() {
      return ironflow.listWorkers();
    },
    async listRuns() {
      const { runs } = await ironflow.listRuns({ limit: RECENT_RUNS });
      return runs ?? [];
    },
    async health() {
      // The status, not the absence of a throw: a reachable engine that reports
      // itself unhealthy is not one this page should call running.
      const { status } = await ironflow.health();
      return status === "ok" || status === "healthy";
    },
    async notificationsHeartbeat() {
      return ironflow.kv().bucket(HEARTBEAT_BUCKET).get(NOTIFICATIONS_HEARTBEAT_KEY);
    },
    async getOrders() {
      const result = await ironflow.getProjection<OrdersProjection>(ORDERS_PROJECTION);
      return result.state ?? { orders: {} };
    },
    async subscribeToOrders(onUpdate) {
      listeners.add(onUpdate);
      shared ??= ironflow.subscribeToProjection<OrdersProjection>(ORDERS_PROJECTION, {
        onUpdate: (state) => {
          for (const listener of listeners) listener(state ?? { orders: {} });
        },
      });
      // Await it so a failure to connect reaches the caller's error state.
      await shared;
      // Dropping a listener never closes the shared subscription: the page
      // keeps it for its lifetime, which is the whole demo.
      return { unsubscribe: () => listeners.delete(onUpdate) };
    },
  };
}
