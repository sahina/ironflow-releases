const DEFAULT_RUN_PAGE = 1_000;

/**
 * Read a complete, de-duplicated run snapshot through the REST API's offset
 * pagination. A draining system can add runs between pages, so retry the scan
 * when insertions at the front made an offset page overlap an earlier one.
 */
export async function listRunsSnapshot(api, query = {}, { pageSize = DEFAULT_RUN_PAGE, maxPasses = 3 } = {}) {
  let best = { runs: [], totalCount: 0, complete: true };

  for (let pass = 0; pass < maxPasses; pass++) {
    const byId = new Map();
    let offset = 0;
    let totalCount = 0;

    for (;;) {
      const page = await api.runsPage({ ...query, limit: String(pageSize), offset: String(offset) });
      const runs = page.runs ?? [];
      totalCount = Math.max(totalCount, Number(page.total_count ?? runs.length));
      for (const run of runs) byId.set(run.id, run);
      offset += runs.length;
      if (runs.length === 0 || offset >= totalCount) break;
    }

    const snapshot = { runs: [...byId.values()], totalCount, complete: byId.size >= totalCount };
    if (snapshot.runs.length > best.runs.length || snapshot.totalCount > best.totalCount) best = snapshot;
    if (snapshot.complete) return snapshot;
  }

  return best;
}

/** Count the statuses in one run snapshot. */
export function runsByStatus(runs) {
  return runs.reduce((counts, run) => {
    counts[run.status] = (counts[run.status] ?? 0) + 1;
    return counts;
  }, {});
}

/** How many facts with `eventName` the order projection has recorded. */
export function projectedFactCount(order, eventName) {
  return (order?.timeline ?? []).filter((entry) => entry.event === eventName).length;
}
