/**
 * The app's own database. This is the ONLY file that opens a socket to
 * Postgres directly, and it connects exclusively to `ragapp`.
 *
 * Ironflow's database is reached through @ironflow/node and nothing else.
 * If you ever find yourself importing this module to read run or projection
 * state, the tenant is being broken — use the client instead.
 */
import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.RAGAPP_DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "RAGAPP_DATABASE_URL is not set. Copy .env.example to .env.",
      );
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

/**
 * Create the app schema.
 *
 * Note what is NOT here: no hnsw index on `embedding`, no gin index on `tsv`.
 * The hybrid query in src/query.ts computes the distance and ts_rank in its
 * SELECT list and sorts on a blended score. Postgres cannot satisfy that with
 * an ANN or full-text index — HNSW only serves a bare
 * `ORDER BY embedding <=> $vec LIMIT k`, and GIN only serves `tsv @@ query` in
 * a WHERE. Creating them would cost build time and write amplification while
 * never being chosen, and would imply the search is index-backed when it is a
 * full scan.
 *
 * That is the right trade here: the demo corpus is a few hundred rows and the
 * blended query is far easier to read than the alternative.
 *
 * ponytail: full scan, correct but O(rows). For a real corpus, switch
 * src/query.ts to Reciprocal Rank Fusion — two CTEs, each with its own
 * ORDER BY ... LIMIT so each can use an index — then add hnsw and gin back.
 * Two things to get right when you do: apply the restatement supersession
 * BEFORE the top-K or the results fill with stale rows, and handle pgvector's
 * filtered-HNSW recall drop (hnsw.iterative_scan, or a partial index per
 * index_version).
 */
export async function createSchema(): Promise<void> {
  const db = getPool();
  // audit-ignore: side-effect-outside-step — one-shot DDL run from setup.ts at
  // the shell, never from a durable handler.
  await db.query(`
    CREATE EXTENSION IF NOT EXISTS vector;

    CREATE TABLE IF NOT EXISTS chunks (
      chunk_id      TEXT PRIMARY KEY,
      doc_id        TEXT NOT NULL,
      kind          TEXT NOT NULL,            -- 'prose' | 'table_summary'
      table_id      TEXT,
      entity        TEXT NOT NULL,
      period        TEXT NOT NULL,
      as_of         DATE NOT NULL,
      section       TEXT NOT NULL,
      page          INTEGER NOT NULL,
      text          TEXT NOT NULL,
      embedding     vector(1024) NOT NULL,
      tsv           tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED,
      index_version INTEGER NOT NULL
    );

    -- The one index the query actually uses. See the comment above.
    CREATE INDEX IF NOT EXISTS chunks_version_idx ON chunks (index_version);

    CREATE TABLE IF NOT EXISTS index_pointer (
      id                   INTEGER PRIMARY KEY DEFAULT 1,
      active_index_version INTEGER NOT NULL DEFAULT 0,
      CONSTRAINT single_row CHECK (id = 1)
    );

    INSERT INTO index_pointer (id, active_index_version)
    VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
  `);
}

/** Which index version is currently serving queries. */
export async function readPointer(): Promise<number> {
  const result = await getPool().query<{ active_index_version: number }>(
    "SELECT active_index_version FROM index_pointer WHERE id = 1",
  );
  return result.rows[0]?.active_index_version ?? 0;
}

/**
 * Move the live pointer, but only if it still holds `expected`.
 *
 * Compare-and-swap, not a blind UPDATE. Two evals can pass close together and
 * there is no ordering between their promote runs, so a plain write lets an
 * older version land after a newer one — and lets a rollback clobber a good
 * promotion made in between. Returns false when someone else moved it first,
 * which the caller treats as "not mine to change".
 */
export async function comparePointer(
  expected: number,
  next: number,
): Promise<boolean> {
  const result = await getPool().query(
    `UPDATE index_pointer SET active_index_version = $1
       WHERE id = 1 AND active_index_version = $2`,
    [next, expected],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Unconditional pointer write. Only for setup and tests — promotion and
 * rollback both go through comparePointer so they cannot race each other.
 */
export async function writePointer(version: number): Promise<void> {
  await getPool().query(
    "UPDATE index_pointer SET active_index_version = $1 WHERE id = 1",
    [version],
  );
}
