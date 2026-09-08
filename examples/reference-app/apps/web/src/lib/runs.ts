// Resolving timeline facts to the runs they started.
//
// The projection and run list now expose the same event id. Joining on that
// engine-owned identifier avoids depending on every function input carrying an
// `orderId`, and it keeps another order's recent runs out of this timeline.

export type RunSummary = {
  id: string;
  /** The function this run executed, which is what names the link. */
  functionId: string;
  /** The event that started this run. */
  eventId: string;
};

/** Reads the engine's run list, dropping any record this UI cannot understand. */
export function parseRuns(raw: unknown[]): RunSummary[] {
  return raw.flatMap((entry) => {
    if (entry === null || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const id = record.id;
    const functionId = record.function_id ?? record.functionId;
    const eventId = record.event_id ?? record.eventId;
    if (typeof id !== "string" || typeof functionId !== "string" || typeof eventId !== "string") return [];
    return [{ id, functionId, eventId }];
  });
}

/**
 * Every recent run these facts caused, in whatever order the engine listed them.
 * A retry produces a second run for the same function, so the link text carries
 * the run id as well — two identical links would look like a rendering bug.
 */
export function runsForEvents(runs: RunSummary[], eventIds: readonly string[]): RunSummary[] {
  const wanted = new Set(eventIds.filter(Boolean));
  if (wanted.size === 0) return [];
  return runs.filter((run) => wanted.has(run.eventId));
}
