import { createClient } from "@ironflow/node";
import { getPool, readPointer } from "./db.js";
import { embed, toVectorLiteral } from "./embed.js";
import { buildHybridQuery, escapeLikePattern, escapeLiteral } from "./query.js";

const client = createClient({
  serverUrl: process.env.IRONFLOW_URL ?? "http://localhost:9123",
});

export interface Hit {
  chunkId: string;
  docId: string;
  kind: "prose" | "table_summary";
  tableId: string | null;
  entity: string;
  period: string;
  asOf: string;
  section: string;
  page: number;
  text: string;
  score: number;
}

export interface TableRow {
  docId: string;
  tableId: string;
  entity: string;
  period: string;
  label: string;
  value: string;
  unit: string;
  page: number;
  asOf: string;
}

/**
 * Run-scoped index version override.
 *
 * The agent's tools are module constants, registered once at import. They
 * cannot take the candidate version as an argument, but the eval must make
 * them read the shadow index rather than the live one — otherwise the agent
 * tier scores the corpus that is already promoted.
 *
 * Module-level mutable state is only safe here because `run-eval` sets
 * `concurrency: { limit: 1 }`. Two overlapping evals would clobber each
 * other's version. That concurrency limit is load-bearing, not tidiness.
 */
let scopedVersion: number | undefined;

/** Point every reader at one index version until cleared. */
export function withIndexVersion(version: number | undefined): void {
  scopedVersion = version;
}

/** Explicit argument wins, then the run-scoped override, then the live pointer. */
async function resolveVersion(explicit?: number): Promise<number> {
  return explicit ?? scopedVersion ?? (await readPointer());
}

export interface SearchOptions {
  query: string;
  entity?: string;
  period?: string;
  limit?: number;
  /**
   * Which index version to read. Defaults to the LIVE pointer.
   *
   * The eval must pass the candidate version explicitly — otherwise it scores
   * the corpus that is already live and the promotion gate approves an index
   * it never looked at.
   */
  indexVersion?: number;
}

/**
 * Hybrid search over one index version.
 *
 * Defaults to the live pointer, so user-facing queries cannot see a shadow
 * index mid-ingest. The eval overrides it with the candidate version — that
 * override is the whole point of the gate.
 */
export async function searchDocuments(opts: SearchOptions): Promise<Hit[]> {
  const indexVersion = await resolveVersion(opts.indexVersion);
  const [vector] = await embed([opts.query]);

  const { sql, params } = buildHybridQuery({
    vectorLiteral: toVectorLiteral(vector!),
    keywords: opts.query,
    indexVersion,
    entity: opts.entity,
    period: opts.period,
    limit: opts.limit ?? 8,
  });

  const result = await getPool().query(sql, params);
  const hits: Hit[] = result.rows.map((r) => ({
    chunkId: r.chunk_id,
    docId: r.doc_id,
    kind: r.kind,
    tableId: r.table_id,
    entity: r.entity,
    period: r.period,
    asOf:
      r.as_of instanceof Date ? r.as_of.toISOString().slice(0, 10) : r.as_of,
    section: r.section,
    page: r.page,
    text: r.text,
    score: Number(r.score),
  }));

  // OPTIONAL RERANK STEP — left off by default.
  //
  // A cross-encoder reads (query, passage) pairs together instead of comparing
  // two independently-computed vectors, so it is markedly better at ranking
  // near-ties. That is exactly the case here: several table summaries from the
  // same filing look similar to a bi-encoder.
  //
  // The cost is one extra model call per query, on the latency path, for every
  // question the agent asks — and the eval asks one per golden row. Turn it on
  // when retrieval tier scores plateau below where you need them.
  //
  //   const reranked = await rerank(opts.query, hits);
  //   return reranked.slice(0, opts.limit ?? 8);

  return hits;
}

/**
 * Read actual figures out of Ironflow's table-row projection.
 *
 * The second hop of the two-hop pattern: search finds the table (via its
 * embedded summary), this reads the number. Numbers are never retrieved by
 * similarity, because "close to 1,284,000" is not an answer.
 */
export async function queryTable(opts: {
  entity?: string;
  period?: string;
  label?: string;
  limit?: number;
  /** Defaults to the LIVE pointer. The eval passes the candidate version. */
  indexVersion?: number;
}): Promise<TableRow[]> {
  // Scoped to a single index version, exactly like searchDocuments. Without
  // this, figures from a shadow batch are answerable the moment they are
  // extracted — before the eval runs and even if it later fails — which
  // defeats the entire shadow-then-promote design.
  const indexVersion = await resolveVersion(opts.indexVersion);
  const clauses: string[] = [`index_version = ${Number(indexVersion)}`];

  // Values here are model-supplied. The projection query API takes a WHERE
  // clause string rather than bind parameters, so every value is escaped.
  if (opts.entity) clauses.push(`entity = '${escapeLiteral(opts.entity)}'`);
  if (opts.period) clauses.push(`period = '${escapeLiteral(opts.period)}'`);
  if (opts.label) {
    // Two escapes, in this order: LIKE metacharacters first so the label
    // matches literally, then quoting for the clause grammar.
    const pattern = escapeLiteral(escapeLikePattern(opts.label));
    clauses.push(`label LIKE '%${pattern}%'`);
  }

  const result = await client.sqlProjections.query("table_rows", {
    where: clauses.join(" AND "),
    orderBy: "as_of DESC",
    limit: opts.limit ?? 200,
  });

  const col = (name: string) => result.columns.indexOf(name);
  const rows = result.rows.map((r) => ({
    docId: r[col("doc_id")] ?? "",
    tableId: r[col("table_id")] ?? "",
    entity: r[col("entity")] ?? "",
    period: r[col("period")] ?? "",
    label: r[col("label")] ?? "",
    value: r[col("value")] ?? "",
    unit: r[col("unit")] ?? "",
    page: Number(r[col("page")] ?? 0),
    asOf: r[col("as_of")] ?? "",
  }));

  return supersede(rows);
}

function supersedeKey(row: TableRow): string {
  // (entity, period, label) — NOT tableId. tableId comes from the extraction
  // schema, which means the model invents it, separately, per filing. The
  // original and the restatement are parsed in independent runs, so their
  // tableIds do not match and keying on it means neither row supersedes the
  // other: query_table returns the old figure alongside the corrected one.
  //
  // This also matches the SQL side's PARTITION BY entity, period in
  // src/query.ts, so the two supersession rules agree instead of drifting.
  //
  // JSON.stringify, not a separator-join: a label containing the separator
  // would collide two distinct rows into one, and financial labels are full of
  // punctuation. Same reasoning as stableId in src/hash.ts.
  return JSON.stringify([row.entity, row.period, row.label]);
}

/**
 * Keep only the newest filing's version of each figure.
 *
 * Restatements are the whole reason this exists: the same entity, period and
 * label can appear in two filings with different numbers, and the later `as_of`
 * is the answer. Done here rather than in SQL because the projection query
 * grammar has no window functions.
 */
export function supersede(rows: TableRow[]): TableRow[] {
  const newestAsOf = new Map<string, string>();
  for (const row of rows) {
    const key = supersedeKey(row);
    const seen = newestAsOf.get(key);
    if (!seen || row.asOf > seen) newestAsOf.set(key, row.asOf);
  }
  return rows.filter(
    (row) => newestAsOf.get(supersedeKey(row)) === row.asOf,
  );
}

/** What is in the corpus, and as of when. Scoped to one index version. */
export async function listSources(opts?: {
  indexVersion?: number;
}): Promise<{ docId: string; entity: string; period: string; asOf: string }[]> {
  // Version-scoped for the same reason queryTable is: otherwise the agent can
  // truthfully report a filing as "covered" while it sits in an unpromoted
  // batch, and then answer questions about it.
  const indexVersion = await resolveVersion(opts?.indexVersion);
  const result = await client.sqlProjections.query("documents", {
    where: `index_version = ${Number(indexVersion)}`,
    orderBy: "as_of DESC",
    limit: 200,
  });
  const col = (name: string) => result.columns.indexOf(name);
  return result.rows.map((r) => ({
    docId: r[col("doc_id")] ?? "",
    entity: r[col("entity")] ?? "",
    period: r[col("period")] ?? "",
    asOf: r[col("as_of")] ?? "",
  }));
}
