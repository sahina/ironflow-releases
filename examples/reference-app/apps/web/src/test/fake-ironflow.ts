// The client seam, faked. Tests observe what a click sent rather than mocking a
// module, so the components stay free to change inside.

import type { CommandMetadata, EmitResult, IronflowClient } from "@/lib/client";
import type { OrdersProjection } from "@/lib/orders";

export type SentCommand = { event: string; data: unknown; metadata: CommandMetadata };

export type FakeIronflow = IronflowClient & {
  emitted: SentCommand[];
  /** How many times the run list was asked for. Lazy reads are a claim to test. */
  runsRequested: number;
  /** Pushes a projection update to every subscriber, the way the engine would. */
  publish(state: OrdersProjection): void;
};

/** What the engine would answer, for the reads a view makes beyond the projection. */
export type FakeEngineState = {
  workers?: unknown[];
  runs?: unknown[];
  engineHealthy?: boolean;
  heartbeat?: unknown;
  /** An engine that answers, but not this route. */
  runsFail?: boolean;
  /** A real engine does not answer in a microtask. */
  runsDelayMs?: number;
};

export function fakeIronflow(
  initial: OrdersProjection = { orders: {} },
  {
    workers = [],
    runs = [],
    engineHealthy = true,
    heartbeat = undefined,
    runsFail = false,
    runsDelayMs = 0,
  }: FakeEngineState = {},
): FakeIronflow {
  const emitted: SentCommand[] = [];
  const subscribers: ((state: OrdersProjection) => void)[] = [];
  let state = initial;

  const fake: FakeIronflow = {
    emitted,
    runsRequested: 0,
    publish(next) {
      state = next;
      for (const notify of subscribers) notify(next);
    },
    async emit(event, data, metadata): Promise<EmitResult> {
      emitted.push({ event, data, metadata });
      return { eventId: `evt-${emitted.length}`, runIds: [`run-${emitted.length}`] };
    },
    async listWorkers() {
      return workers;
    },
    async listRuns() {
      fake.runsRequested += 1;
      if (runsDelayMs > 0) await new Promise((done) => setTimeout(done, runsDelayMs));
      if (runsFail) throw new Error("runs are unavailable");
      return runs;
    },
    async health() {
      return engineHealthy;
    },
    async notificationsHeartbeat() {
      return heartbeat;
    },
    async getOrders() {
      return state;
    },
    async subscribeToOrders(onUpdate) {
      subscribers.push(onUpdate);
      return {
        unsubscribe() {
          subscribers.splice(subscribers.indexOf(onUpdate), 1);
        },
      };
    },
  };
  return fake;
}
