import { stableId } from "./id.js";

export interface Chunk {
  chunkId: string;
  docId: string;
  seq: number;
  heading: string;
  text: string;
}

/** Max characters per chunk. Sections longer than this split at paragraph
 *  boundaries. Small on purpose — the corpus is small and retrieval is
 *  sharper with focused chunks. */
export const MAX_CHUNK_CHARS = 1500;

/**
 * Split markdown into chunks by heading, then cap length at paragraph
 * boundaries. Deterministic: same input, same chunks, same chunkIds — the
 * whole pipeline's idempotency hangs off that.
 */
export function chunkMarkdown(docId: string, markdown: string): Chunk[] {
  const lines = markdown.split("\n");
  const sections: { heading: string; body: string[] }[] = [];
  let current = { heading: docId, body: [] as string[] };

  for (const line of lines) {
    const match = /^#{1,3}\s+(.*)$/.exec(line);
    if (match) {
      if (current.body.join("").trim()) sections.push(current);
      current = { heading: match[1]!.trim(), body: [] };
    } else {
      current.body.push(line);
    }
  }
  if (current.body.join("").trim()) sections.push(current);

  const chunks: Chunk[] = [];
  for (const section of sections) {
    const paragraphs = section.body
      .join("\n")
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);

    let buffer = "";
    const flush = () => {
      if (!buffer) return;
      const seq = chunks.length;
      chunks.push({
        chunkId: stableId("chunk", docId, String(seq), buffer),
        docId,
        seq,
        heading: section.heading,
        text: buffer,
      });
      buffer = "";
    };

    for (const paragraph of paragraphs) {
      if (buffer && buffer.length + paragraph.length + 2 > MAX_CHUNK_CHARS) flush();
      buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
    }
    flush();
  }
  return chunks;
}
