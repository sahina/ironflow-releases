import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { EMBEDDING_DIM } from "./embed.js";
import type { Chunk } from "./chunk.js";

export interface Hit {
  chunkId: string;
  docId: string;
  heading: string;
  text: string;
  distance: number;
}

/**
 * The app-owned store. Ironflow never sees this file — the index is derived
 * from Ironflow events by the vector-index projection, which is what makes it
 * rebuildable: delete rag.db, replay, and it comes back without re-embedding
 * (the vectors ride in the events).
 *
 * better-sqlite3 is synchronous by design here: projection handlers stay
 * simple, and there is no `await <db>` for the anti-pattern audit to misread.
 */
export function openDb(path = process.env.RAG_DB ?? "./rag.db"): Database.Database {
  const conn = new Database(path);
  sqliteVec.load(conn);
  conn.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      chunk_id TEXT PRIMARY KEY,
      doc_id   TEXT NOT NULL,
      seq      INTEGER NOT NULL,
      heading  TEXT NOT NULL,
      text     TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
      chunk_id TEXT PRIMARY KEY,
      embedding float[${EMBEDDING_DIM}]
    );
  `);
  return conn;
}

/** Insert once; a replayed event is a no-op. Returns false when already present. */
export function insertChunk(
  conn: Database.Database,
  chunk: Chunk,
  embedding: number[],
): boolean {
  const exists = conn
    .prepare("SELECT 1 FROM chunks WHERE chunk_id = ?")
    .get(chunk.chunkId);
  if (exists) return false;

  const insert = conn.transaction(() => {
    conn
      .prepare("INSERT INTO chunks (chunk_id, doc_id, seq, heading, text) VALUES (?, ?, ?, ?, ?)")
      .run(chunk.chunkId, chunk.docId, chunk.seq, chunk.heading, chunk.text);
    conn
      .prepare("INSERT INTO vec_chunks (chunk_id, embedding) VALUES (?, ?)")
      .run(chunk.chunkId, Buffer.from(new Float32Array(embedding).buffer));
  });
  insert();
  return true;
}

/** KNN over the vec0 index, joined back to the metadata table. */
export function searchChunks(
  conn: Database.Database,
  embedding: number[],
  k = 8,
): Hit[] {
  const rows = conn
    .prepare(
      `SELECT v.chunk_id AS chunkId, c.doc_id AS docId, c.heading, c.text, v.distance
       FROM vec_chunks v
       JOIN chunks c ON c.chunk_id = v.chunk_id
       WHERE v.embedding MATCH ? AND k = ?
       ORDER BY v.distance`,
    )
    .all(Buffer.from(new Float32Array(embedding).buffer), k);
  return rows as Hit[];
}
