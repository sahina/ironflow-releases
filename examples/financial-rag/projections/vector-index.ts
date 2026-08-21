import { createProjection } from "@ironflow/node";
import {
  EVENTS,
  type ChunkExtracted,
  type TableSummaryWritten,
} from "../events.js";
import { getPool } from "../src/db.js";
import { embed, toVectorLiteral } from "../src/embed.js";

/**
 * The one component that writes outside Ironflow, and only because a SQL
 * projection's read path cannot express a similarity query (issue #1641).
 *
 * External mode — no initialState, so this is side-effects-only. Rebuildable:
 * truncate `chunks` and replay, and it comes back without re-parsing a PDF.
 * That is the payoff of keeping extraction results as events rather than as
 * rows in a table someone has to migrate.
 */
interface IndexedEvent {
  name: string;
  data: unknown;
}

// Both generics stay `unknown`: IronflowProjection is invariant in TEvent, so
// narrowing here makes the worker's projections array reject this projection.
// The narrowing happens inside the handler instead.
export const vectorIndex = createProjection<unknown, unknown>({
  name: "vector-index",
  events: [EVENTS.ChunkExtracted, EVENTS.TableSummaryWritten],
  handler: async (raw: unknown) => {
    const event = raw as IndexedEvent;
    const isProse = event.name === EVENTS.ChunkExtracted;
    const data = event.data as ChunkExtracted & TableSummaryWritten;

    const text = isProse ? data.text : data.summary;
    // A table summary is keyed by its table, not by a chunk id — it is the one
    // artifact that exists to make a table findable rather than to be an answer.
    const chunkId = isProse ? data.chunkId : `summary:${data.tableId}`;
    const [vector] = await embed([text]);

    await getPool().query(
      `INSERT INTO chunks
         (chunk_id, doc_id, kind, table_id, entity, period, as_of, section, page, text, embedding, index_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::vector,$12)
       ON CONFLICT (chunk_id) DO NOTHING`,
      [
        chunkId,
        data.docId,
        isProse ? "prose" : "table_summary",
        isProse ? null : data.tableId,
        data.entity,
        data.period,
        data.asOf,
        data.section,
        data.page,
        text,
        toVectorLiteral(vector!),
        data.indexVersion,
      ],
    );
  },
});
