import { defineTool } from "@ironflow/node/agent";
import { z } from "zod";
import { listSources, queryTable, searchDocuments } from "./retriever.js";

/**
 * Four tools, deliberately not three or six.
 *
 * The split matters: `search_documents` finds WHERE an answer lives,
 * `query_table` reads the actual figure. Numbers never come back through
 * similarity search, because "close to 1,284,000" is not an answer. The other
 * two exist to stop the model guessing about coverage.
 */

export const searchDocumentsTool = defineTool({
  name: "search_documents",
  description:
    "Search filings for relevant passages and table summaries. Use this FIRST to find which filing and table an answer lives in. Returns text, not figures — read figures with query_table.",
  input: z.object({
    query: z.string().describe("What to look for, in natural language"),
    entity: z.string().optional().describe("Ticker or company, e.g. 'ACME'"),
    period: z.string().optional().describe("Reporting period, e.g. '2024-Q3'"),
    limit: z.number().optional(),
  }),
  handler: async (input) => {
    const hits = await searchDocuments(input);
    return hits.map((h) => ({
      docId: h.docId,
      kind: h.kind,
      tableId: h.tableId,
      entity: h.entity,
      period: h.period,
      asOf: h.asOf,
      section: h.section,
      page: h.page,
      text: h.text.slice(0, 1500),
      score: Number(h.score.toFixed(4)),
    }));
  },
});

export const queryTableTool = defineTool({
  name: "query_table",
  description:
    "Read exact figures from extracted financial tables. Use this for ANY number you intend to state. Results are already superseded — if a filing was restated, only the latest figure is returned.",
  input: z.object({
    entity: z.string().optional(),
    period: z.string().optional(),
    label: z
      .string()
      .optional()
      .describe("Row label to match, e.g. 'Total revenue'"),
    limit: z.number().optional(),
  }),
  handler: async (input) => queryTable(input),
});

export const listSourcesTool = defineTool({
  name: "list_sources",
  description:
    "List every filing in the corpus with its entity, period and as-of date. Call this when the question names a period or company you are not sure is covered, before answering 'I don't know'.",
  input: z.object({}),
  handler: async () => listSources(),
});

export const compareperiodsTool = defineTool({
  name: "compare_periods",
  description:
    "Fetch the same table row across two periods so they can be compared. Use this instead of two separate query_table calls when the question is about change over time.",
  input: z.object({
    entity: z.string(),
    label: z.string(),
    periods: z.array(z.string()).min(2).max(4),
  }),
  handler: async (input) => {
    const results = await Promise.all(
      input.periods.map(async (period) => ({
        period,
        rows: await queryTable({
          entity: input.entity,
          period,
          label: input.label,
        }),
      })),
    );
    return results;
  },
});

export const TOOLS = [
  searchDocumentsTool,
  queryTableTool,
  listSourcesTool,
  compareperiodsTool,
];
