// What `/system` can honestly say about each of the five participants.
//
// The interesting part of this page is not "is it up" but "how would you know".
// Each of the four processes proves it is alive differently, and one of them —
// the Python subscriber — cannot use either mechanism the others do.

import { type Heartbeat, heartbeatIsFresh } from "@/lib/heartbeat";
import {
  ORDER_FUNCTION_ID,
  PAYMENT_FUNCTION_ID,
  workerIsFresh,
  type WorkerSummary,
} from "@/lib/workers";

export type ServiceKey = "engine" | "orders" | "payments" | "notifications" | "browser";

/**
 * `unknown` is not a third display state dressed up as one. "Gone" is a claim
 * about a process, and an engine this page cannot reach does not support it.
 */
export type Health = "up" | "down" | "unknown";

/** What a service is, before anything is known about whether it is running. */
export type Service = {
  key: ServiceKey;
  name: string;
  language: "Go" | "TypeScript" | "Python";
  role: string;
  /** How this page would know, which differs per service and is the point. */
  evidence: string;
  /** Where its code lives, relative to `examples/reference-app`. */
  source: string;
};

export type ServiceRow = Service & { health: Health };

/**
 * The five participants, described once.
 *
 * Both the status list and the source list read this, so a service cannot
 * appear in one and be missing from the other.
 */
export const SERVICES: Service[] = [
  {
    key: "engine",
    name: "Ironflow engine",
    language: "Go",
    role: "The event backbone, runtime, history and read-model store every process shares.",
    evidence: "Answers /health on the port the supervisor discovered.",
    // The engine is the one participant that is not part of this example.
    source: "",
  },
  {
    key: "orders",
    name: "Ordering",
    language: "Go",
    role: "Owns the order stream, the approval rules, the durable wait and the read model.",
    evidence: "A pull-mode worker with a fresh heartbeat on its order function.",
    source: "services/orders-go",
  },
  {
    key: "payments",
    name: "Payments",
    language: "TypeScript",
    role: "Owns the payment stream and the two durable gateway steps.",
    evidence: "A pull-mode worker with a fresh heartbeat on its payment function.",
    source: "services/payments-node",
  },
  {
    key: "notifications",
    name: "Notifications",
    language: "Python",
    role: "Subscribes to the order-status topic and records one local delivery per message.",
    // The whole reason this row exists in its own shape.
    evidence:
      "A KV heartbeat: the Python SDK ships no worker runtime, so this process registers no worker and appears in no worker list.",
    source: "services/notifications-python",
  },
  {
    key: "browser",
    name: "This page",
    language: "TypeScript",
    role: "Sends commands and follows the order projection. It never folds a raw stream.",
    evidence: "Its own projection subscription is delivering updates.",
    source: "apps/web",
  },
];

export type StatusInputs = {
  engineReachable: boolean;
  workers: WorkerSummary[];
  notificationsHeartbeat: Heartbeat | undefined;
  /**
   * Whether this page's own projection subscription is delivering, or
   * `undefined` before the first answer. The same three-way distinction the
   * rest of this file makes: not knowing yet is not the same as not working.
   */
  readModelConnected: boolean | undefined;
  now: number;
};

function workerHealth(inputs: StatusInputs, functionId: string): Health {
  // An engine this page cannot reach cannot report on the workers behind it.
  if (!inputs.engineReachable) return "unknown";
  return workerIsFresh(inputs.workers, functionId, inputs.now) ? "up" : "down";
}

function subscriberHealth(inputs: StatusInputs): Health {
  // Two different unknowns, and neither is "gone": an engine this page cannot
  // reach, and a heartbeat it has not read yet. Only a heartbeat that exists
  // and is old supports the claim that the subscriber stopped.
  if (!inputs.engineReachable || inputs.notificationsHeartbeat === undefined) return "unknown";
  return heartbeatIsFresh(inputs.notificationsHeartbeat, inputs.now) ? "up" : "down";
}

/** Each service, with what this page can currently claim about it. */
export function serviceRows(inputs: StatusInputs): ServiceRow[] {
  const health: Record<ServiceKey, Health> = {
    engine: inputs.engineReachable ? "up" : "down",
    orders: workerHealth(inputs, ORDER_FUNCTION_ID),
    payments: workerHealth(inputs, PAYMENT_FUNCTION_ID),
    notifications: subscriberHealth(inputs),
    browser:
      !inputs.engineReachable || inputs.readModelConnected === false
        ? "down"
        : inputs.readModelConnected === undefined
          ? "unknown"
          : "up",
  };
  return SERVICES.map((service) => ({ ...service, health: health[service.key] }));
}

/** What each health reads as on the page. */
export const HEALTH_LABELS: Record<Health, string> = {
  up: "Running",
  down: "Not running",
  unknown: "Unknown",
};
