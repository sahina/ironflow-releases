import { describe, expect, it } from "vitest";
import { EMBEDDING_DIM, localEmbedding } from "../src/embed.js";

describe("localEmbedding (offline fallback)", () => {
  it("is deterministic with the right dimension", () => {
    const a = localEmbedding("forge dev port 4311");
    expect(a).toHaveLength(EMBEDDING_DIM);
    expect(a).toEqual(localEmbedding("forge dev port 4311"));
  });

  it("is L2-normalised", () => {
    const norm = Math.hypot(...localEmbedding("some text here"));
    expect(norm).toBeCloseTo(1, 6);
  });

  it("keeps token-overlapping texts closer than disjoint ones", () => {
    const dot = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * y[i]!, 0);
    const base = localEmbedding("the dev server listens on port 4311");
    const near = localEmbedding("dev server port");
    const far = localEmbedding("unrelated words entirely different");
    expect(dot(base, near)).toBeGreaterThan(dot(base, far));
  });
});
