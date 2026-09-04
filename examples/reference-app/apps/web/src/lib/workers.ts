// Worker presence, as this UI reads it.
//
// The engine keeps no liveness of its own for a REST worker: nothing removes a
// record, so a SIGKILLed worker stays in `GET /api/v1/workers` and its
// replacement registers beside it under a new id. Presence is therefore a
// question about heartbeats, not about the list being empty.

export type WorkerSummary = { id: string; functionIds: string[]; lastHeartbeat: string };

/**
 * Must match `FN_PROCESS_PAYMENT` in services/payments-node/src/main.ts.
 *
 * A third copy, and deliberately so: this module is bundled for the browser and
 * cannot import from `scripts/lib/workers.mjs`, which holds the same two
 * constants for the supervisor and the live scripts. The supervisor's readiness
 * probe is what actually catches a rename — it asks the engine for a worker
 * running this id, so the whole example fails to start rather than losing this
 * indicator quietly.
 */
export const PAYMENT_FUNCTION_ID = "process-payment";

/**
 * Must match `order.FnPlaceOrder` in services/orders-go/internal/order/functions.go.
 *
 * Guarded the same way: the ordering row's readiness probe in
 * `scripts/dev.mjs` asks the engine for a worker running this id, so a rename
 * on one side alone fails `make reference-app` at startup rather than pinning
 * the /system row to "Not running" forever.
 */
export const ORDER_FUNCTION_ID = "place-order";

/**
 * How long a heartbeat stays evidence of a live worker.
 *
 * The payment worker heartbeats every 3s (main.ts), so this leaves room for two
 * missed ticks. It is deliberately short: a presenter crashes the worker in
 * front of an audience and needs to see it go.
 */
export const FRESH_HEARTBEAT_MS = 10_000;

/** Reads the REST worker list, dropping any record this UI cannot understand. */
export function parseWorkers(raw: unknown[]): WorkerSummary[] {
  return raw.flatMap((entry) => {
    if (entry === null || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const id = record.id;
    const functionIds = record.function_ids ?? record.functionIds;
    const lastHeartbeat = record.last_heartbeat ?? record.lastHeartbeat;
    if (typeof id !== "string" || !Array.isArray(functionIds) || typeof lastHeartbeat !== "string") return [];
    return [{ id, functionIds: functionIds.filter((f): f is string => typeof f === "string"), lastHeartbeat }];
  });
}

/**
 * Whether some worker running `functionId` has heartbeated recently.
 *
 * One rule for every service, because the reason is the same for all of them:
 * the engine never removes a worker record, so a record existing says nothing
 * and only the heartbeat does.
 */
export function workerIsFresh(workers: WorkerSummary[], functionId: string, now: number): boolean {
  return workers.some((worker) => {
    if (!worker.functionIds.includes(functionId)) return false;
    const beat = Date.parse(worker.lastHeartbeat);
    return Number.isFinite(beat) && now - beat <= FRESH_HEARTBEAT_MS;
  });
}

/** The operations view's question: is the payment worker running? */
export function paymentWorkerPresent(workers: WorkerSummary[], now: Date): boolean {
  return workerIsFresh(workers, PAYMENT_FUNCTION_ID, now.getTime());
}
