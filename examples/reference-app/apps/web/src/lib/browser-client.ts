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

// One subscription per page generation, shared until its last registration leaves.
interface OrdersGeneration {
  registrations: Set<(state: OrdersProjection) => void>;
  promise: Promise<{ unsubscribe(): void }>;
  subscription?: { unsubscribe(): void };
}
let shared: OrdersGeneration | undefined;

function closeGeneration(generation: OrdersGeneration): void {
  if (shared === generation) shared = undefined;
  generation.registrations.clear();
  generation.subscription?.unsubscribe();
}

export function browserIronflow({ serverUrl, apiKey }: { serverUrl: string; apiKey: string }): IronflowClient {
  const settings = `${serverUrl}|${apiKey}`;
  if (configuredFor !== settings) {
    if (shared) closeGeneration(shared);
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
      return ironflow.kv().bucket(HEARTBEAT_BUCKET).getJSON(NOTIFICATIONS_HEARTBEAT_KEY);
    },
    async getOrders() {
      const result = await ironflow.getProjection<OrdersProjection>(ORDERS_PROJECTION);
      return result.state ?? { orders: {} };
    },
    async subscribeToOrders(onUpdate) {
      if (!shared) {
        const generation: OrdersGeneration = {
          registrations: new Set(),
          promise: Promise.resolve().then(() => {
            if (shared !== generation) throw new Error("orders subscription canceled by configure");
            return ironflow.subscribeToProjection<OrdersProjection>(ORDERS_PROJECTION, {
              onUpdate: (state) => {
                for (const registration of generation.registrations) {
                  registration(state ?? { orders: {} });
                }
              },
            });
          }).then((subscription) => {
            if (shared !== generation) {
              subscription.unsubscribe();
              throw new Error("orders subscription canceled by configure");
            }
            generation.subscription = subscription;
            return subscription;
          }, (error: unknown) => {
            closeGeneration(generation);
            throw error;
          }),
        };
        shared = generation;
      }
      const generation = shared;
      const registration = (state: OrdersProjection) => onUpdate(state);
      generation.registrations.add(registration);
      await generation.promise;
      return {
        unsubscribe: () => {
          generation.registrations.delete(registration);
          if (generation.registrations.size === 0 && shared === generation) closeGeneration(generation);
        },
      };
    },
  };
}
