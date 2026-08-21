import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createClient, createFunction } from "@ironflow/node";
import { EVENTS, type ChunkEmbedded, type DocumentIndexed } from "../events.js";
import { chunkMarkdown } from "../src/chunk.js";
import { embed } from "../src/embed.js";
import { stableId } from "../src/id.js";

// createWorker picks IRONFLOW_API_KEY up from the environment on its own;
// createClient does not, so pass it explicitly or every emit 401s.
const client = createClient({
  serverUrl: process.env.IRONFLOW_URL ?? "http://localhost:9123",
  apiKey: process.env.IRONFLOW_API_KEY,
});

const CORPUS_DIR = process.env.CORPUS_DIR ?? "./corpus";

/**
 * Ingest: read the corpus, chunk, embed, emit.
 *
 * Durable correctness, and — since #1670 — mostly durable progress too. The
 * worker checkpoints finished steps to the server on a ~1s debounce, so a
 * killed worker loses at most the current window rather than the whole run.
 * The index still ends exactly right either way, because every emit below
 * derives its idempotencyKey from content and the server drops the duplicates.
 * See the step.map comment for the details.
 *
 * concurrency 1: two overlapping ingests of the same folder would only race
 * each other to emit identical (idempotent) events — harmless, but noisy.
 */
export const ingestCorpus = createFunction(
  {
    id: "ingest-corpus",
    description: "Chunk and embed every markdown file in the corpus, then emit one event per chunk.",
    triggers: [{ event: EVENTS.IngestRequested }],
    concurrency: { limit: 1 },
    mode: "pull",
    recording: true,
  },
  async ({ step, logger }) => {
    const files = await step.run("list-corpus", async () => {
      const entries = await readdir(CORPUS_DIR);
      return entries.filter((e) => e.endsWith(".md")).sort();
    });

    const results = await step.map(
      "ingest-doc",
      files,
      // `docStep` is the scoped step client for THIS branch, and using it is
      // load-bearing. step.map does not memoize a branch on its own — it just
      // runs the callback (sdk/js/node/src/step.ts, executeParallel). Ignore
      // `docStep` and the whole map is one opaque blob: a 3000-document run
      // persisted exactly ONE step (`list-corpus`). Wrapping the body in
      // docStep.run gives each document its own memoized step, which is what
      // makes an in-worker retry skip finished documents and what makes the
      // per-document timeline visible to `ironflow inspect`.
      //
      // Since #1670 those steps also survive a kill: startCheckpointer PUTs
      // completed steps as `status: "progress"` on a debounce
      // (CHECKPOINT_INTERVAL_MS 1s, MAX_CHECKPOINT_STEPS 500 per flush), so a
      // reclaimed run resumes past everything already checkpointed and loses at
      // most the last window. Two caveats: a server that 4xxs a checkpoint
      // disables it for the rest of the job and falls back to ship-on-completion,
      // and a burst that outruns the 500-per-flush drain leaves a tail for the
      // terminal PUT. Correctness never depended on any of it — every emit
      // below is idempotent.
      //
      // The step id strips ".md" deliberately: an id goes verbatim into the
      // NATS subject `system.run.{runId}.step.{stepId}.{event}` and
      // escapeStepIdPart escapes only ":" and "\", so a dot adds a subject
      // token and the dashboard's fixed-arity step-event check stops matching.
      async (file, docStep) =>
        docStep.run(`embed-and-emit:${file.replace(/\.md$/, "")}`, async () => {
          const docId = file.replace(/\.md$/, "");
          const markdown = await readFile(join(CORPUS_DIR, file), "utf8");
          const contentHash = stableId("content", markdown);
          const chunks = chunkMarkdown(docId, markdown);
          const vectors = await embed(chunks.map((c) => c.text), "document");

          // All emits inside ONE memoized step per doc. If the step retries
          // after a partial emit, every idempotencyKey derives from content, so
          // the server drops the duplicates.
          for (const [i, chunk] of chunks.entries()) {
            const payload: ChunkEmbedded = { ...chunk, embedding: vectors[i]!, contentHash };
            await client.emit(EVENTS.ChunkEmbedded, payload, {
              idempotencyKey: stableId("chunk-embedded", chunk.chunkId, contentHash),
            });
          }
          const done: DocumentIndexed = { docId, contentHash, chunks: chunks.length };
          await client.emit(EVENTS.DocumentIndexed, done, {
            idempotencyKey: stableId("doc-indexed", docId, contentHash),
          });
          return done;
        }),
      { concurrency: 4 },
    );

    logger.info("ingest complete", {
      docs: results.length,
      chunks: results.reduce((s, r) => s + r.chunks, 0),
    });
    return { docs: results.length };
  },
);
