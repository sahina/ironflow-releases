// Event names as a typed contract. All demo events in one module so the
// reference surface is self-documenting. In a real app, scope constants
// per bounded context (one events.ts per domain).
//
//   EVENTS — function triggers, waitForEvent match targets, emit/publish
//            topics. Reference-app mixes demo commands, cron fires, and
//            integration pub/sub in a single namespace for clarity.
//   STREAM_EVENTS — entity-stream event names (bank-account example).

export const EVENTS = {
  // Simple workflow demos
  DemoSimple: "demo.simple",
  DemoAdvanced: "demo.advanced",
  DemoApproved: "demo.approved",
  DemoHotPatch: "demo.hot-patch",
  DemoParallel: "demo.parallel",
  DemoMap: "demo.map",
  DemoSleepUntil: "demo.sleep-until",
  DemoConcurrency: "demo.concurrency",
  DemoActor: "demo.actor",
  DemoTimeout: "demo.timeout",
  DemoInvoke: "demo.invoke",
  DemoSaga: "demo.saga",
  DemoPubSubWorkflow: "demo.pubsub-workflow",
  DemoSecrets: "demo.secrets",
  DemoNotifications: "demo.notifications",

  // Cron fires
  CronReporter1m: "cron.reporter.1m",
  CronReporter2m: "cron.reporter.2m",
  CronReporter5m: "cron.reporter.5m",
  CronScheduledReport: "cron.scheduled-report",

  // Worker-pattern demos
  WorkerDataPipeline: "worker.data-pipeline",
  WorkerBatchProcess: "worker.batch-process",
} as const;

export const STREAM_EVENTS = {
  AccountOpened: "account.opened",
  MoneyDeposited: "money.deposited",
  MoneyWithdrawn: "money.withdrawn",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
export type StreamEventName = (typeof STREAM_EVENTS)[keyof typeof STREAM_EVENTS];
