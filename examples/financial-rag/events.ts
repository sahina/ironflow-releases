/**
 * The event contract. Everything else in this example is downstream of it.
 *
 * `document.version.created` is produced by appending to an entity stream
 * (which triggers subscribers); the rest are emitted with client.emit inside a
 * durable step.
 *
 * Every field a SQL projection handler references must appear here. A handler
 * naming a `:data.x` the event omits is a hard runtime error, not a null.
 */
export const EVENTS = {
  /**
   * The cron tick that drives W1. A cron trigger still needs an event name —
   * the scheduler emits this on the schedule and the function is triggered by
   * it. Nothing else emits or consumes it.
   */
  PollTick: "ingest.poll.tick",
  DocumentVersionCreated: "document.version.created",
  ChunkExtracted: "chunk.extracted",
  TableRowExtracted: "table.row.extracted",
  TableSummaryWritten: "table.summary.written",
  DocumentParsed: "document.parsed",
  IngestBatchClosed: "ingest.batch.closed",
  EvalPassed: "eval.passed",
  EvalRegressed: "eval.regressed",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

/** Scope carried by every artifact so restatements resolve correctly. */
export interface Scope {
  entity: string; // "ACME"
  period: string; // "2024-Q3"
  asOf: string; // ISO date the filing was made — the restatement tiebreaker
  indexVersion: number; // which shadow/live index this belongs to
}

export interface DocumentVersionCreated extends Scope {
  docId: string;
  sourceKey: string;
  contentHash: string;
  batchId: string;
}

export interface ChunkExtracted extends Scope {
  chunkId: string;
  docId: string;
  section: string;
  page: number;
  text: string;
}

export interface TableRowExtracted extends Scope {
  rowId: string;
  docId: string;
  tableId: string;
  page: number;
  label: string; // "Total revenue"
  value: string; // "1234.5" — string on the wire, numeric in the projection
  unit: string; // "USD thousands"
}

export interface TableSummaryWritten extends Scope {
  tableId: string;
  docId: string;
  section: string;
  page: number;
  summary: string;
}

export interface DocumentParsed {
  batchId: string;
  docId: string;
  chunks: number;
  rows: number;
  tables: number;
}

export interface IngestBatchClosed {
  batchId: string;
  indexVersion: number;
  parsed: number;
  failed: number;
}

/**
 * The eval verdict, exactly as it goes on the wire.
 *
 * Two fields are shaped for the projection handler rather than for ergonomics,
 * and the declared type has to say so or it is a lie the `as` cast hides:
 * `failingCsv` is a joined string because a SQL handler takes scalars only,
 * and `judgedMean` is a string for the same reason.
 */
export interface EvalVerdict {
  runKey: string;
  indexVersion: number;
  batchId: string;
  numericPassed: number;
  numericTotal: number;
  retrievalPassed: number;
  retrievalTotal: number;
  judgedMean: string;
  failingCsv: string;
}
