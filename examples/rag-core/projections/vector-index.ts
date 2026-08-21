import { createProjection } from "@ironflow/node";
import { EVENTS, type ChunkEmbedded } from "../events.js";
import { insertChunk, openDb } from "../src/db.js";

const db = openDb();

/**
 * External projection: the ONE component that writes outside Ironflow, and
 * only because this example runs on SQLite. #1641 shipped indexable SQL
 * projections and allowlists the `vector` extension, but pgvector is
 * PostgreSQL-only — a managed projection could hold this index on Postgres,
 * not here. Part 6 of the series does that swap.
 *
 * Rebuildable by construction: delete rag.db, replay the events, and the
 * index comes back byte-identical — no embedding API involved, because the
 * vectors ride in the events. better-sqlite3 is synchronous, so the handler
 * has no awaited I/O at all.
 */
export const vectorIndex = createProjection<unknown, unknown>({
  name: "vector-index",
  events: [EVENTS.ChunkEmbedded],
  handler: async (raw: unknown) => {
    const event = raw as { name: string; data: ChunkEmbedded };
    const { embedding, contentHash: _hash, ...chunk } = event.data;
    insertChunk(db, chunk, embedding);
  },
});
