// Worker presence, shared by the supervisor and both live scripts.
//
// Three callers were each re-deriving the same two constants and the same
// filter. The freshness window in particular is a judgement about the payment
// worker's heartbeat interval, and three independent copies of it drift the
// moment that interval changes.
//
// `apps/web/src/lib/workers.ts` deliberately keeps its own copy: it is bundled
// for the browser and cannot import from `scripts/`. It names this file.

/**
 * Must match `FN_PROCESS_PAYMENT` in services/payments-node/src/main.ts.
 *
 * Nothing enforces that at compile time — the worker is a separate package and
 * the browser copy is a third. What does enforce it is the supervisor: the
 * payments row's readiness probe below asks the engine for a worker running
 * this id, so a rename on one side alone fails `make reference-app` at startup
 * rather than silently disabling the presence indicator.
 */
export const PAYMENT_FUNCTION_ID = "process-payment";

/**
 * Must match `order.FnPlaceOrder` in services/orders-go/internal/order/functions.go,
 * and `ORDER_FUNCTION_ID` in apps/web/src/lib/workers.ts.
 *
 * Guarded the same way as the payment id, and for a sharper reason: nothing
 * else names it. `/system` reads it to decide whether Ordering is running, so a
 * rename with no probe would pin that row to "Not running" forever with no
 * error anywhere.
 */
export const ORDER_FUNCTION_ID = "place-order";

/**
 * How long a heartbeat stays evidence of a live worker.
 *
 * The payment worker heartbeats every 3s (payments-node/src/main.ts), so this
 * leaves room for two missed ticks. Deliberately short: a presenter crashes the
 * worker in front of an audience and needs to see it go.
 */
export const FRESH_HEARTBEAT_MS = 10_000;

/**
 * The ids of workers running `functionId` whose heartbeat is still fresh.
 *
 * The engine never removes a worker record (internal/server/worker_rest.go has
 * no reaper), so a SIGKILLed worker stays listed and its replacement appears
 * beside it under a new id. "Some worker is listed" is therefore always true
 * after the first boot; only the heartbeat says whether one is alive.
 */
export function freshWorkerIds(workers, functionId = PAYMENT_FUNCTION_ID, now = Date.now()) {
  const cutoff = now - FRESH_HEARTBEAT_MS;
  return workers
    .filter((worker) => (worker.function_ids ?? []).includes(functionId))
    .filter((worker) => Date.parse(worker.last_heartbeat) >= cutoff)
    .map((worker) => worker.id);
}
