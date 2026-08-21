import { PDFDocument } from "pdf-lib";

export interface PageRange {
  index: number;
  start: number; // 1-indexed, inclusive
  end: number; // 1-indexed, inclusive
}

/** Page ranges for a document. Ranges are what durable steps are keyed on. */
export function planRanges(pageCount: number, size: number): PageRange[] {
  const ranges: PageRange[] = [];
  for (let start = 1, index = 0; start <= pageCount; start += size, index++) {
    ranges.push({ index, start, end: Math.min(start + size - 1, pageCount) });
  }
  return ranges;
}

/**
 * Physically cut the PDF into one document per range.
 *
 * Required, not an optimisation: a Claude `document` content block takes a
 * whole PDF and has no page-range parameter, so per-range memoization only
 * exists if the pieces actually exist.
 */
export async function splitPdf(
  bytes: Uint8Array,
  ranges: PageRange[],
): Promise<Uint8Array[]> {
  const source = await PDFDocument.load(bytes);
  const parts: Uint8Array[] = [];

  for (const range of ranges) {
    const out = await PDFDocument.create();
    const indices: number[] = [];
    for (let p = range.start; p <= range.end; p++) indices.push(p - 1);
    const copied = await out.copyPages(source, indices);
    for (const page of copied) out.addPage(page);
    parts.push(await out.save());
  }

  return parts;
}
