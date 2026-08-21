import { createHash } from "node:crypto";

/** voyage-finance-2 is 1024-dimensional. The chunks table hard-codes this. */
export const EMBEDDING_DIM = 1024;

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";

/**
 * Embed a batch of texts.
 *
 * Batched deliberately: Voyage takes an array, and one request per chunk would
 * be both slow and rate-limit bait.
 *
 * voyage-finance-2 rather than a general-purpose model because finance
 * retrieval is where it earns its keep — tickers, line-item labels, and
 * accounting acronyms.
 */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey || apiKey.startsWith("pa-...")) {
    return texts.map(localEmbedding);
  }

  // audit-ignore: side-effect-outside-step — this is the HTTP client itself, not
  // a handler body. Its callers are the vector-index projection (external mode,
  // no step to wrap in) and retriever helpers invoked from inside step.run().
  const response = await fetch(VOYAGE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: "voyage-finance-2", input: texts }),
  });
  if (!response.ok) {
    throw new Error(
      `voyage embeddings failed: ${response.status} ${await response.text()}`,
    );
  }
  const body = (await response.json()) as { data: { embedding: number[] }[] };
  return body.data.map((d) => d.embedding);
}

/**
 * Deterministic offline stand-in, used when VOYAGE_API_KEY is unset.
 *
 * This is NOT a semantic embedding and will not retrieve sensibly — it exists
 * so the pipeline runs end to end without a Voyage account, and so the
 * hybrid query's keyword half can be exercised on its own. Set a real key
 * before drawing any conclusion from retrieval quality.
 *
 * Hashed token bucketing, L2-normalised: identical text gives an identical
 * vector, and texts sharing tokens land closer than texts that share none,
 * which is just enough structure for a smoke test.
 */
export function localEmbedding(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIM).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

  for (const token of tokens) {
    const digest = createHash("sha256").update(token).digest();
    const bucket = digest.readUInt32BE(0) % EMBEDDING_DIM;
    // Sign from a second byte so different tokens can cancel rather than only
    // accumulate, which keeps unrelated texts from all pointing the same way.
    vector[bucket]! += digest[4]! % 2 === 0 ? 1 : -1;
  }

  const norm = Math.hypot(...vector);
  if (norm === 0) return vector;
  return vector.map((v) => v / norm);
}

/** True when embeddings are the offline stand-in rather than real Voyage output. */
export function isOfflineEmbedding(): boolean {
  const key = process.env.VOYAGE_API_KEY;
  return !key || key.startsWith("pa-...");
}

/** pgvector accepts a bracketed literal; no client-side type registration needed. */
export function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}
