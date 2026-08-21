import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const client = new Anthropic();

/**
 * The extraction schema carries `page` explicitly.
 *
 * Native citations would be the obvious way to get page numbers, but
 * `citations: {enabled: true}` returns a 400 alongside `output_config.format`.
 * Structured output wins, so page numbers ride inside the schema instead.
 */
const ExtractionSchema = z.object({
  sections: z.array(
    z.object({
      section: z
        .string()
        .describe("The filing's own heading, e.g. 'Risk Factors'"),
      page: z.number().describe("1-indexed page within the ORIGINAL filing"),
      text: z.string(),
    }),
  ),
  tables: z.array(
    z.object({
      tableId: z.string(),
      section: z.string(),
      page: z.number(),
      summary: z
        .string()
        .describe(
          "One paragraph in plain English describing what this table contains. This gets embedded so semantic search can FIND the table.",
        ),
      rows: z.array(
        z.object({
          label: z.string().describe("Row label, e.g. 'Total revenue'"),
          value: z
            .string()
            .describe("The figure as it appears, digits only, no separators"),
          unit: z.string().describe("e.g. 'USD thousands', 'shares', 'percent'"),
        }),
      ),
    }),
  ),
});

export type Extraction = z.infer<typeof ExtractionSchema>;

const SYSTEM = `You extract structured data from financial filings.

Rules:
- Prose splits on the filing's OWN section headings. Never invent headings.
- Tables are NEVER returned as prose. Every table becomes rows plus one
  plain-English summary paragraph.
- Numbers are transcribed exactly as printed. Never compute, round, or infer a
  figure that is not on the page.
- Page numbers are 1-indexed against the ORIGINAL filing, not this excerpt.
  The excerpt you are reading starts at the page number given in the prompt.`;

/**
 * Extract one page-range PDF.
 *
 * Called from inside a durable step, so a failure here retries this range only
 * — which is the entire reason the PDF was physically split first.
 */
export async function extractRange(
  pdf: Uint8Array,
  ctx: { docId: string; startPage: number },
): Promise<Extraction> {
  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { format: zodOutputFormat(ExtractionSchema) },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: Buffer.from(pdf).toString("base64"),
            },
          },
          {
            type: "text",
            text: `This excerpt begins at page ${ctx.startPage} of the filing. Extract every section and every table.`,
          },
        ],
      },
    ],
  });

  if (!response.parsed_output) {
    throw new Error(
      `extraction returned no parsed output for ${ctx.docId} at page ${ctx.startPage}`,
    );
  }
  return response.parsed_output;
}
