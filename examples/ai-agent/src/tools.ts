// Simulated AI agent tools.
//
// In production replace with real APIs (Tavily, Anthropic, etc.). Each
// helper is wrapped in a defineTool() so the agent can call it via
// ctx.tool() — durable, validated, idempotent, with a 60s timeout.

import { defineTool } from "@ironflow/node/agent";
import type { LLMCompleteResult } from "@ironflow/node/agent";
import { z } from "zod";

export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
}

export const webSearch = defineTool({
  name: "web-search",
  description: "Search the web for sources on a topic",
  input: z.object({ query: z.string().min(1) }),
  idempotent: "byArgs",
  handler: async ({ query }): Promise<SearchResult[]> => {
    await new Promise((r) => setTimeout(r, 100));
    return [
      {
        title: `Understanding ${query}`,
        snippet: `A comprehensive guide to ${query}, covering fundamentals, best practices, and real-world applications.`,
        url: `https://example.com/guide/${encodeURIComponent(query)}`,
      },
      {
        title: `${query} in Practice`,
        snippet: `How top teams implement ${query} with practical examples and case studies.`,
        url: `https://example.com/practice/${encodeURIComponent(query)}`,
      },
      {
        title: `Common Mistakes with ${query}`,
        snippet: `Avoid these pitfalls when working with ${query}. Lessons from production debugging.`,
        url: `https://example.com/mistakes/${encodeURIComponent(query)}`,
      },
    ];
  },
});

// Simulated LLM call. Swap with a real provider — see the inline comment
// in the code-review-agent example for an Anthropic reference.
export async function summarizeWith(
  topic: string,
  sources: SearchResult[],
): Promise<LLMCompleteResult> {
  await new Promise((r) => setTimeout(r, 50));
  const summary =
    `Research summary for "${topic}": ` +
    `Analyzed ${sources.length} sources. ` +
    `Findings cover fundamentals, practical implementation, and common pitfalls. ` +
    `Sources include guides, case studies, and lessons from production systems.`;
  return { content: summary, finishReason: "stop" };
}
