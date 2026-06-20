// Event names as a typed contract.
//   EVENTS — function triggers + integration publish topics (cross-service
//            notifications consumed by other workers, no entity-stream
//            contract)
//   STREAM_EVENTS — domain events recorded in the fraud-eval entity stream.
//                   Projections and upcasters depend on these names.

export const EVENTS = {
  TransactionAuthorized: "transaction.authorized",
  FraudAlerts: "fraud-alerts",
} as const;

export const STREAM_EVENTS = {
  SignalsCollected: "signals_collected",
  ModelScored: "model_scored",
  DecisionMade: "decision_made",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
export type StreamEventName = (typeof STREAM_EVENTS)[keyof typeof STREAM_EVENTS];
