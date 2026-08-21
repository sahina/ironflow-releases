import { describe, expect, it } from "vitest";
import { chunkMarkdown, MAX_CHUNK_CHARS } from "../src/chunk.js";
import { stableId } from "../src/id.js";

const DOC = `# Title

Intro paragraph.

## Section A

First paragraph of A.

Second paragraph of A.

## Section B

Only paragraph of B.
`;

describe("stableId", () => {
  it("is deterministic and 32 hex chars", () => {
    expect(stableId("a", "b")).toBe(stableId("a", "b"));
    expect(stableId("a", "b")).toMatch(/^[0-9a-f]{32}$/);
    expect(stableId("a", "b")).not.toBe(stableId("a", "c"));
  });
});

describe("chunkMarkdown", () => {
  it("splits by heading and carries the heading on each chunk", () => {
    const chunks = chunkMarkdown("doc", DOC);
    expect(chunks.map((c) => c.heading)).toEqual(["Title", "Section A", "Section B"]);
    expect(chunks[1]!.text).toContain("First paragraph of A.");
  });

  it("assigns sequential seq and deterministic ids", () => {
    const a = chunkMarkdown("doc", DOC);
    const b = chunkMarkdown("doc", DOC);
    expect(a.map((c) => c.seq)).toEqual([0, 1, 2]);
    expect(a.map((c) => c.chunkId)).toEqual(b.map((c) => c.chunkId));
  });

  it("caps chunk length at paragraph boundaries", () => {
    const long = "## Big\n\n" + Array.from({ length: 20 }, (_, i) => `Paragraph ${i} ${"x".repeat(200)}.`).join("\n\n");
    const chunks = chunkMarkdown("doc", long);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
  });

  it("skips empty sections", () => {
    expect(chunkMarkdown("doc", "# A\n\n## B\n\nText.\n")).toHaveLength(1);
  });
});
