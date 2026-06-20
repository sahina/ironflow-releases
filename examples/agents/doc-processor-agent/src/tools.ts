import { defineTool } from "@ironflow/node/agent";
import { z } from "zod";

// ── Tools ───────────────────────────────────────────────────────
//
// Each tool() call is a memoized step. If the worker is killed
// while a tool is in flight, restart re-runs that one tool from
// scratch. Anything that completed before the crash replays from
// cache — including its output, so downstream steps stay consistent.
//
// The OCR sleep is the kill window for the demo. Real OCR APIs
// take seconds anyway; this just makes the timing predictable.
//
// ────────────────────────────────────────────────────────────────

const OCR_SLEEP_MS = Number(process.env.DOC_PROCESSOR_OCR_MS ?? 3000);

export const ocr = defineTool({
  name: "ocr",
  description: "Extract text from a document image",
  input: z.object({ imageUrl: z.string().url() }),
  handler: async ({ imageUrl }) => {
    console.log(`[ocr] extracting text from ${imageUrl} (${OCR_SLEEP_MS}ms)...`);
    await new Promise((r) => setTimeout(r, OCR_SLEEP_MS));
    const text = imageUrl.includes("invoice")
      ? "INVOICE #1234 — Amount due: $99.00"
      : `Extracted text from ${imageUrl}`;
    return { text, pages: 1 };
  },
});

export const classify = defineTool({
  name: "classify",
  description: "Categorize an OCR'd document",
  input: z.object({ text: z.string() }),
  handler: async ({ text }) => {
    console.log(`[classify] categorizing ${text.length} chars...`);
    await new Promise((r) => setTimeout(r, 200));
    const lowered = text.toLowerCase();
    const category = lowered.includes("invoice")
      ? "invoice"
      : lowered.includes("receipt")
        ? "receipt"
        : "other";
    return { category };
  },
});

export const publish = defineTool({
  name: "publish",
  description: "Publish a processed document to its category channel",
  input: z.object({ docId: z.string(), category: z.string() }),
  handler: async ({ docId, category }) => {
    console.log(`[publish] doc ${docId} → ${category} channel`);
    return { published: true };
  },
});
