import { describe, expect, it } from "vitest";
import { chunkMarkdown } from "../src/chunk.js";
import { localEmbedding } from "../src/embed.js";
import { insertChunk, openDb, searchChunks } from "../src/db.js";

function seeded() {
  const db = openDb(":memory:");
  const chunks = chunkMarkdown(
    "guide",
    "# A\n\nThe dev server listens on port 4311.\n\n# B\n\nDelete the cache folder to fix stale pages.\n\n# C\n\nPlugins load in order from the config file.\n",
  );
  for (const c of chunks) insertChunk(db, c, localEmbedding(c.text));
  return { db, chunks };
}

describe("sqlite-vec store", () => {
  it("round-trips: nearest chunk to a text's own embedding is that chunk", () => {
    const { db, chunks } = seeded();
    const hits = searchChunks(db, localEmbedding(chunks[0]!.text), 3);
    expect(hits[0]!.chunkId).toBe(chunks[0]!.chunkId);
    expect(hits[0]!.distance).toBeCloseTo(0, 5);
    expect(hits).toHaveLength(3);
  });

  it("insert is idempotent by chunkId", () => {
    const { db, chunks } = seeded();
    expect(insertChunk(db, chunks[0]!, localEmbedding(chunks[0]!.text))).toBe(false);
    expect(searchChunks(db, localEmbedding("port"), 10)).toHaveLength(3);
  });

  it("returns joined metadata", () => {
    const { db } = seeded();
    const [hit] = searchChunks(db, localEmbedding("stale pages cache"), 1);
    expect(hit!.docId).toBe("guide");
    expect(hit!.heading).toMatch(/^[ABC]$/);
    expect(hit!.text.length).toBeGreaterThan(0);
  });
});
