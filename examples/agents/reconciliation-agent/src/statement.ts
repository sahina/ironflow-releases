import { serverUrl } from "./config.js";
import { createClient, createFunction } from "@ironflow/node";
import { EVENTS } from "./events.js";
import { reconcile, type LearnedRule, type Statement } from "./reconcile.js";

// FunctionContext carries no client and StepClient has no projections
// accessor — construct one here and call it from inside a step.
const client = createClient({ serverUrl });

// ── Reconcile run ──────────────────────────────────────────────
//
// One pure deterministic pass over the whole statement in ONE step: there is
// no external call to protect and nothing to resume into, so a step per
// transaction would spend 100 durable rows on a pure function.
//
// Then one independent case run per cluster, requested by event, because a
// counterparty who never answers must not block the other nine cases.
// ────────────────────────────────────────────────────────────────

export const reconcileStatement = createFunction(
  {
    id: "reconcile-statement",
    name: "Reconcile statement",
    triggers: [{ event: EVENTS.StatementReceived }],
    recording: true,
  },
  async ({ event, step, logger }) => {
    const statement = event.data as Statement;

    const rules = await step.run("load-learned-rules", async () => {
      // projections.get returns a ProjectionStateResult wrapper, not the
      // state itself. A freshly registered projection with no events
      // applied yet returns an empty `state` ({}) and version 0 rather than
      // throwing — normal on the very first statement, not an error.
      const result = await client.projections.get<Record<string, LearnedRule[]>>("reconciliation-curated-rules");
      return Object.values(result.state).flat();
    });

    const result = await step.run("reconcile", async () => reconcile(statement, rules));

    logger.info("deterministic pass complete", {
      matched: result.matched.length,
      escalated: result.clusters.length,
      ratio: result.matchedRatio,
    });

    for (const cluster of result.clusters) {
      // The server deduplicates across statement runs, including concurrent
      // arrivals and a retry after emission but before this step persists.
      // A projection read followed by invokeAsync would race both the other
      // statement and projection catch-up. One retained case request owns
      // this period/counterparty, even after that case closes.
      await step.run(`request-${cluster.caseId}`, async () => {
        const request = () => client.emit(EVENTS.CaseRequested, {
          caseId: cluster.caseId,
          periodStart: statement.periodStart,
          cluster,
        }, { idempotencyKey: `reconciliation:${cluster.caseId}` });
        try {
          return await request();
        } catch {
          // Concurrent inserts can both miss the initial lookup. Only one
          // commits, but Trigger currently reports the loser as an untyped
          // internal error. One repeat with the same key safely retrieves
          // the winner and finishes dispatch. A second failure propagates.
          return request();
        }
      });
    }

    return {
      matchedRatio: result.matchedRatio,
      matched: result.matched.length,
      escalated: result.clusters.length,
      caseIds: result.clusters.map((c) => c.caseId),
      rulesApplied: result.rulesApplied,
    };
  },
);
