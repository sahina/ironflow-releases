// The narrow boundary between this application and Ironflow.
//
// Components reach the engine only through this interface, never through an
// imported SDK singleton — that is what lets a test observe the exact command a
// click produced without mocking a module.

import type { OrdersProjection } from "@/lib/orders";

export type CommandMetadata = {
  correlationId: string;
  causationId: string;
  producer: "web";
  demoSessionId: string;
};

export type EmitResult = { eventId: string; runIds: string[] };

export type IronflowClient = {
  emit(event: string, data: unknown, metadata: CommandMetadata): Promise<EmitResult>;
  getOrders(): Promise<OrdersProjection>;
  /**
   * The engine's worker list, raw. `lib/workers.ts` reads it: the shape is the
   * REST response, not something this application defines, so parsing it is a
   * tested step rather than an assumption buried in the adapter.
   */
  listWorkers(): Promise<unknown[]>;
  /**
   * The engine's recent runs, raw. Read lazily, only when someone opens a
   * timeline, so an idle page never polls for links nobody asked for.
   */
  listRuns(): Promise<unknown[]>;
  /** Whether the engine answers at all. Every other claim rests on this one. */
  health(): Promise<boolean>;
  /**
   * The Python subscriber's KV liveness entry, raw.
   *
   * It has no worker record to look up: the Python SDK ships no worker runtime.
   * `lib/heartbeat.ts` reads the entry.
   */
  notificationsHeartbeat(): Promise<unknown>;
  subscribeToOrders(onUpdate: (state: OrdersProjection) => void): Promise<{ unsubscribe(): void }>;
};
