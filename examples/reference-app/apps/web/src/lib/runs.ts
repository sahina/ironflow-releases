// Resolving an order to the runs behind it.
//
// NOT by event id. The projection records `ProjectionEvent.ID`, which on the
// live path is the outbox entry's UUID, while a run's `event_id` is the entity
// event id — two id spaces that never overlap, so a lookup joining them renders
// no link at all against a real engine while passing happily against a fake.
// (A projection *rebuild* passes the real event id, which is what makes the
// mistake look right when you read the code.)
//
// What both sides genuinely share is the order. Every function in this example
// is triggered by an event whose data carries `orderId`, and the engine records
// that data as the run's input — so the join is on the domain identifier, which
// is also the one a reader would have picked.

export type RunSummary = {
  id: string;
  /** The function this run executed, which is what names the link. */
  functionId: string;
  /** The order the triggering event was about, when it was about one. */
  orderId?: string;
};

/** Reads the engine's run list, dropping any record this UI cannot understand. */
export function parseRuns(raw: unknown[]): RunSummary[] {
  return raw.flatMap((entry) => {
    if (entry === null || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const id = record.id;
    const functionId = record.function_id ?? record.functionId;
    if (typeof id !== "string" || typeof functionId !== "string") return [];
    const input = record.input;
    const orderId =
      input !== null && typeof input === "object"
        ? (input as Record<string, unknown>).orderId
        : undefined;
    return [{ id, functionId, orderId: typeof orderId === "string" ? orderId : undefined }];
  });
}

/**
 * Every recent run this order caused, in whatever order the engine listed them.
 * A retry produces a second run for the same function, so the link text carries
 * the run id as well — two identical links would look like a rendering bug.
 */
export function runsForOrder(runs: RunSummary[], orderId: string): RunSummary[] {
  // The empty check is load-bearing: without it an order with no id would match
  // every run whose input carries none.
  if (!orderId) return [];
  return runs.filter((run) => run.orderId === orderId);
}
