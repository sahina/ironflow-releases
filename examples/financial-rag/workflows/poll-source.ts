import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, createFunction } from "@ironflow/node";
import { EVENTS, type IngestBatchClosed } from "../events.js";
import {
  diffChangedSet,
  hashContent,
  stableId,
  type SourceObject,
} from "../src/hash.js";

const client = createClient({
  serverUrl: process.env.IRONFLOW_URL ?? "http://localhost:9123",
});

const SOURCE_DIR = process.env.SOURCE_DIR ?? "./corpus";

/** Filenames encode scope for the example: ACME_2024-Q3_2024-11-01.pdf */
export function parseScope(key: string): {
  entity: string;
  period: string;
  asOf: string;
} {
  const [entity, period, asOf] = key.replace(/\.pdf$/, "").split("_");
  if (!entity || !period || !asOf) {
    throw new Error(
      `filename does not encode scope: ${key} (expected ENTITY_PERIOD_ASOF.pdf)`,
    );
  }
  return { entity, period, asOf };
}

/**
 * W1 — discover, diff, open a batch, fan out, wait, close.
 *
 * concurrency limit 1 because a batch can outlive the 15-minute tick and two
 * overlapping polls would allocate two index versions for the same documents.
 */
export const pollSource = createFunction(
  {
    id: "poll-source",
    description:
      "Every 15 minutes: hash the source filings, diff against what has been ingested, open a shadow index version for anything changed, and hold the batch open until every filing reports parsed.",
    // A cron Trigger still requires an event name: the scheduler emits this
    // event on the schedule, and the function is triggered by it.
    triggers: [{ event: EVENTS.PollTick, cron: "*/15 * * * *" }],
    concurrency: { limit: 1 },
    mode: "pull",
    recording: true,
  },
  async ({ step, logger }) => {
    const keys = await step.run("list-source", async () => {
      const entries = await readdir(SOURCE_DIR);
      return entries.filter((e) => e.endsWith(".pdf"));
    });

    const source: SourceObject[] = await step.map(
      "hash-object",
      keys,
      // The scoped `keyStep` is load-bearing: without it the map records no
      // step at all and every key is re-read and re-hashed on retry (#1671).
      //
      // The `.pdf` is stripped deliberately. A step ID goes verbatim into the
      // NATS subject `system.run.{runId}.step.{stepId}.{event}`
      // (internal/pubsub/types.go BuildSystemStepTopic) and escapeStepIdPart
      // escapes only ":" and "\", so a dot in the ID adds a subject token and
      // the dashboard's fixed-arity `parts.length === 6` step-event check
      // stops matching — live run refresh silently dies.
      async (key, keyStep) =>
        keyStep.run(`hash:${key.replace(/\.pdf$/, "")}`, async () => ({
          key,
          hash: hashContent(await readFile(join(SOURCE_DIR, key))),
        })),
      { concurrency: 8 },
    );

    const changed = await step.run("diff-seen", async () => {
      // limit 10000 is deliberate here, unlike the poll below: building the
      // seen-map genuinely needs every row.
      const result = await client.sqlProjections.query("documents", {
        limit: 10000,
      });
      const keyCol = result.columns.indexOf("source_key");
      const hashCol = result.columns.indexOf("content_hash");
      const seen = new Map<string, string>();
      for (const row of result.rows) {
        const k = row[keyCol];
        const h = row[hashCol];
        if (k !== undefined && h !== undefined) seen.set(k, h);
      }
      return diffChangedSet(source, seen);
    });

    if (changed.length === 0) {
      logger.info("nothing changed — ending run without opening a batch");
      return { changed: 0 };
    }

    const batch = await step.run("open-batch", async () => {
      const result = await client.sqlProjections.query("documents", {
        orderBy: "index_version DESC",
        limit: 1,
      });
      const col = result.columns.indexOf("index_version");
      const current =
        result.rows.length > 0 ? Number(result.rows[0]![col]) : 0;
      // randomUUID is safe HERE and nowhere else in this example: open-batch
      // has no side effect before it returns, so a retry allocates a fresh id
      // that nothing has seen yet. Contrast emit-artifacts in parse-document.
      return {
        batchId: randomUUID(),
        indexVersion: current + 1,
        expected: changed.length,
      };
    });

    // Appending to the entity stream both records the version AND triggers
    // parse-document — an entity append goes through the event-trigger helper,
    // so there is no separate emit here.
    await step.map(
      "append-version",
      changed,
      // `objStep` is load-bearing. Ignore it and this map records no step at
      // all, so a retry re-appends every version instead of skipping the ones
      // that already committed (#1671).
      async (obj, objStep) => {
        const scope = parseScope(obj.key);
        const docId = obj.key.replace(/\.pdf$/, "");
        await objStep.run(`append:${docId}`, async () => {
          // audit-ignore: missing-expectedversion — this append creates a new
          // document version rather than mutating known state, so there is no
          // version to assert. The idempotencyKey below is the correct guard.
          await client.streams.append(
            docId,
            {
              name: EVENTS.DocumentVersionCreated,
              entityType: "filing",
              data: {
                docId,
                sourceKey: join(SOURCE_DIR, obj.key),
                contentHash: obj.hash,
                ...scope,
                indexVersion: batch.indexVersion,
                batchId: batch.batchId,
              },
            },
            // Derived from the content itself: if the append commits but its
            // response is lost, the step retry appends the SAME key and the
            // server drops the duplicate. Without this a retry starts a second
            // parse-document run and violates proj_documents' primary key.
            { idempotencyKey: stableId("version", docId, obj.hash) },
          );
        });
      },
      { concurrency: 4 },
    );

    // Hold the batch open. Without this the eval would have to guess when
    // parsing finished and would sometimes score a half-built index.
    //
    // NOT step.waitForEvent. Its `match` value is extracted from the run's
    // ORIGINAL triggering event (internal/engine/yield_orchestrator.go:150-162
    // — GetEvent(run.EventID)), and this run is triggered by cron, which
    // carries no batchId. A match expression here resolves to the empty string
    // and correlates against the wrong events. Durable sleep + a projection
    // poll gets the same durability with semantics that actually hold.
    //
    // ponytail: fixed 30s poll interval, no backoff. Fine for a handful of
    // filings; if a batch ever runs to thousands, back this off exponentially.
    let completed = 0;
    for (
      let attempt = 0;
      attempt < 240 && completed < batch.expected;
      attempt++
    ) {
      await step.sleep(`await-parses-${attempt}`, "30s");
      completed = await step.run(`count-parsed-${attempt}`, async () => {
        const result = await client.sqlProjections.query("documents", {
          where: `batch_id = '${batch.batchId}' AND chunks > 0`,
          // limit 1, not 10000 — only totalCount is read, and this runs up to
          // 240 times per batch. Fetching rows here is pure wire waste.
          limit: 1,
        });
        return result.totalCount;
      });
    }

    await step.run("close-batch", async () => {
      const payload: IngestBatchClosed = {
        batchId: batch.batchId,
        indexVersion: batch.indexVersion,
        parsed: completed,
        failed: batch.expected - completed,
      };
      // Same reasoning: a retry here would start a second (expensive) eval.
      await client.emit(EVENTS.IngestBatchClosed, payload, {
        idempotencyKey: stableId("batch-closed", batch.batchId),
      });
    });

    logger.info("batch closed", { batchId: batch.batchId, parsed: completed });
    return { changed: changed.length, indexVersion: batch.indexVersion };
  },
);
