export interface HybridOptions {
  vectorLiteral: string;
  keywords: string;
  indexVersion: number;
  entity?: string;
  period?: string;
  limit: number;
}

/**
 * Build the hybrid retrieval query.
 *
 * Hybrid because finance breaks pure vector search: tickers, line-item labels
 * and acronyms are exact tokens, and semantic similarity blurs exactly the
 * thing you need to match. So dense vectors handle concepts, keyword rank
 * handles exact tokens, and the scores are blended.
 *
 * This is a FULL SCAN, on purpose. The vector distance and ts_rank are computed
 * in the SELECT list and the sort is on a blended score, so no ANN or full-text
 * index can serve it — which is why src/db.ts creates neither. Correct and
 * readable at demo scale (a few hundred rows); see the comment on createSchema
 * for the Reciprocal Rank Fusion rewrite if you point this at a real corpus.
 */
export function buildHybridQuery(opts: HybridOptions): {
  sql: string;
  params: unknown[];
} {
  const params: unknown[] = [];
  const p = (v: unknown) => `$${params.push(v)}`;

  const vec = p(opts.vectorLiteral);
  const kw = p(opts.keywords);
  const version = p(opts.indexVersion);

  const filters: string[] = [];
  if (opts.entity) filters.push(`AND entity = ${p(opts.entity)}`);
  if (opts.period) filters.push(`AND period = ${p(opts.period)}`);

  const limit = p(opts.limit);

  const sql = `
    WITH scoped AS (
      SELECT *,
             RANK() OVER (PARTITION BY entity, period ORDER BY as_of DESC) AS recency
      FROM chunks
      WHERE index_version = ${version}
      ${filters.join("\n      ")}
    ),
    -- RANK, not ROW_NUMBER. ROW_NUMBER numbers rows 1,2,3... within the
    -- partition, so recency = 1 would keep exactly ONE chunk per
    -- (entity, period) and throw away the rest of the filing. RANK gives every
    -- row sharing the newest as_of the same rank 1, which is what "keep the
    -- latest filing, drop the superseded ones" actually means.
    latest AS (SELECT * FROM scoped WHERE recency = 1),
    scored AS (
      SELECT chunk_id, doc_id, kind, table_id, entity, period, as_of, section, page, text,
             (1 - (embedding <=> ${vec}::vector)) AS vec_score,
             ts_rank(tsv, plainto_tsquery('english', ${kw}))  AS kw_score
      FROM latest
    )
    SELECT *, (0.6 * vec_score + 0.4 * kw_score) AS score
    FROM scored
    WHERE vec_score > 0.2 OR kw_score > 0
    ORDER BY score DESC
    LIMIT ${limit}
  `;

  return { sql, params };
}

/**
 * Escape a value for the projection WHERE grammar.
 *
 * Unlike the chunks query above, `client.sqlProjections.query` takes a WHERE
 * *clause string*, not bind parameters — so values must be escaped before
 * composing. The server-side tokenizer treats a doubled quote as a literal
 * quote, which is what makes this the correct escape rather than stripping.
 *
 * Values reaching here are model-supplied. Treat them as hostile: a model that
 * has read a filing mentioning O'Brien will hand you an apostrophe.
 *
 * ponytail: string escaping because the API takes a clause, not params. If the
 * typed-parameter half of issue #1641 ever lands, delete this and bind instead.
 */
export function escapeLiteral(v: string): string {
  return v.replace(/'/g, "''");
}

/**
 * Escape LIKE metacharacters so a value matches literally.
 *
 * Separate from escapeLiteral because they solve different problems and are
 * composed in that order: escapeLikePattern first (content), escapeLiteral
 * second (quoting).
 *
 * `%` and `_` are wildcards in a LIKE pattern. Financial row labels contain
 * them constantly — "Gross margin %", "% of revenue", "net_income" — so an
 * unescaped label silently widens the match and returns a plausible figure
 * from the wrong row. Backslash goes first, or it would escape the escapes.
 */
export function escapeLikePattern(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/[%_]/g, "\\$&");
}
