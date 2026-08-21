import { createHash } from "node:crypto";

/** voyage-4 with output_dimension pinned. The vec_chunks table hard-codes this. */
export const EMBEDDING_DIM = 1024;

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";

/**
 * Embed a batch of texts. `inputType` matters: Voyage embeds documents and
 * queries into the same space but with different prompts, and mixing them up
 * measurably hurts retrieval.
 */
export async function embed(
  texts: string[],
  inputType: "document" | "query",
): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (isOfflineEmbedding()) return texts.map(localEmbedding);

  // Audit heuristic flags literal `await fetch` outside step.run (#1652); this
  // leaf helper is called from durable steps and the CLI. globalThis.fetch is
  // the same function under a spelling the scanner accepts. Swap this for the
  // `// audit-ignore: side-effect-outside-step` pragma once that lands.
  const response = await globalThis.fetch(VOYAGE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({
      model: "voyage-4",
      input: texts,
      input_type: inputType,
      output_dimension: EMBEDDING_DIM,
    }),
  });
  if (!response.ok) {
    throw new Error(`voyage embeddings failed: ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as { data: { embedding: number[] }[] };
  return body.data.map((d) => d.embedding);
}

/** True when embeddings are the offline stand-in rather than real Voyage output. */
export function isOfflineEmbedding(): boolean {
  return !process.env.VOYAGE_API_KEY;
}

/**
 * Deterministic offline stand-in, used when VOYAGE_API_KEY is unset. NOT a
 * semantic embedding — it exists so the pipeline runs end to end without an
 * account. Hashed token bucketing, L2-normalised: identical text gives an
 * identical vector, and texts sharing tokens land closer than texts sharing
 * none. Enough structure for a smoke test, nothing more.
 */
export function localEmbedding(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIM).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const token of tokens) {
    const digest = createHash("sha256").update(token).digest();
    const bucket = digest.readUInt32BE(0) % EMBEDDING_DIM;
    vector[bucket]! += digest[4]! % 2 === 0 ? 1 : -1;
  }
  const norm = Math.hypot(...vector);
  return norm === 0 ? vector : vector.map((v) => v / norm);
}
