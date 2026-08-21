import { EVENTS } from "../events.js";

/**
 * Three managed SQL projections, living inside Ironflow's own database and
 * reached only through client.sqlProjections. No pgvector here — Ironflow
 * never stores a vector.
 *
 * Constraint that shapes all of this: a handler is ONE event -> ONE
 * INSERT/UPDATE/DELETE with scalar params. It cannot fan out, cannot SELECT,
 * and cannot JOIN. That is why the parse workflow emits one event per row
 * rather than one event per document.
 */
/**
 * Declared locally because @ironflow/node does not re-export
 * CreateSQLProjectionInput. Annotating rather than inferring matters here:
 * inference narrows `events` to a union of the literal names used, which then
 * fails to satisfy the `string[]` the client expects.
 */
interface SqlProjection {
  name: string;
  description?: string;
  tableSql: string;
  events: string[];
  eventHandlers: Record<string, string>;
}

export const SQL_PROJECTIONS: SqlProjection[] = [
  {
    name: "documents",
    description:
      "One row per ingested filing version. The seen-set for diffing.",
    tableSql: `CREATE TABLE proj_documents (
      doc_id TEXT NOT NULL,
      source_key TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      entity TEXT NOT NULL,
      period TEXT NOT NULL,
      as_of TEXT NOT NULL,
      index_version INTEGER NOT NULL,
      batch_id TEXT NOT NULL,
      chunks INTEGER NOT NULL DEFAULT 0,
      rows_extracted INTEGER NOT NULL DEFAULT 0,
      tables INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (doc_id, content_hash)
    )`,
    events: [EVENTS.DocumentVersionCreated, EVENTS.DocumentParsed],
    eventHandlers: {
      [EVENTS.DocumentVersionCreated]: `INSERT INTO proj_documents
        (doc_id, source_key, content_hash, entity, period, as_of, index_version, batch_id)
        VALUES (:data.docId, :data.sourceKey, :data.contentHash, :data.entity,
                :data.period, :data.asOf, :data.indexVersion, :data.batchId)`,
      [EVENTS.DocumentParsed]: `UPDATE proj_documents
        SET chunks = :data.chunks, rows_extracted = :data.rows, tables = :data.tables
        WHERE doc_id = :data.docId`,
    },
  },
  {
    name: "table_rows",
    description:
      "Every extracted financial table row. What query_table reads.",
    tableSql: `CREATE TABLE proj_table_rows (
      row_id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      table_id TEXT NOT NULL,
      entity TEXT NOT NULL,
      period TEXT NOT NULL,
      as_of TEXT NOT NULL,
      page INTEGER NOT NULL,
      label TEXT NOT NULL,
      value TEXT NOT NULL,
      unit TEXT NOT NULL,
      index_version INTEGER NOT NULL
    )`,
    events: [EVENTS.TableRowExtracted],
    eventHandlers: {
      [EVENTS.TableRowExtracted]: `INSERT INTO proj_table_rows
        (row_id, doc_id, table_id, entity, period, as_of, page, label, value, unit, index_version)
        VALUES (:data.rowId, :data.docId, :data.tableId, :data.entity, :data.period,
                :data.asOf, :data.page, :data.label, :data.value, :data.unit, :data.indexVersion)`,
    },
  },
  {
    name: "eval_results",
    description: "Per-run eval verdicts. The regression trend line.",
    tableSql: `CREATE TABLE proj_eval_results (
      run_key TEXT PRIMARY KEY,
      index_version INTEGER NOT NULL,
      batch_id TEXT NOT NULL,
      verdict TEXT NOT NULL,
      numeric_passed INTEGER NOT NULL,
      numeric_total INTEGER NOT NULL,
      retrieval_passed INTEGER NOT NULL,
      retrieval_total INTEGER NOT NULL,
      judged_mean TEXT NOT NULL,
      failing TEXT NOT NULL,
      recorded_at TEXT NOT NULL
    )`,
    events: [EVENTS.EvalPassed, EVENTS.EvalRegressed],
    eventHandlers: {
      [EVENTS.EvalPassed]: `INSERT INTO proj_eval_results
        (run_key, index_version, batch_id, verdict, numeric_passed, numeric_total,
         retrieval_passed, retrieval_total, judged_mean, failing, recorded_at)
        VALUES (:data.runKey, :data.indexVersion, :data.batchId, 'passed',
                :data.numericPassed, :data.numericTotal, :data.retrievalPassed,
                :data.retrievalTotal, :data.judgedMean, :data.failingCsv, :timestamp)`,
      [EVENTS.EvalRegressed]: `INSERT INTO proj_eval_results
        (run_key, index_version, batch_id, verdict, numeric_passed, numeric_total,
         retrieval_passed, retrieval_total, judged_mean, failing, recorded_at)
        VALUES (:data.runKey, :data.indexVersion, :data.batchId, 'regressed',
                :data.numericPassed, :data.numericTotal, :data.retrievalPassed,
                :data.retrievalTotal, :data.judgedMean, :data.failingCsv, :timestamp)`,
    },
  },
];
