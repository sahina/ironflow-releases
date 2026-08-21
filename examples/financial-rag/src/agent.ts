import Anthropic from "@anthropic-ai/sdk";
import type { AgentContext } from "@ironflow/node/agent";
import { z } from "zod";
import { TOOLS } from "./tools.js";

const anthropic = new Anthropic();

/**
 * A citation looks like [docId p.12]. Exported so a consumer can reuse the
 * exact shape rather than writing a second regex that drifts from this one.
 */
export const CITATION_RE = /\[([A-Za-z0-9_.-]+)\s+p\.(\d+)\]/g;

/** A figure the answer asserts: any number with 2+ digits. */
const FIGURE_RE = /\b\d{2,}(?:[.,]\d+)*\b/;

export interface AnswerResult {
  answer: string;
  citations: { docId: string; page: number }[];
  refused: boolean;
  turns: number;
}

const SYSTEM = `You answer questions about financial filings.

How to work:
1. Call search_documents first to find where the answer lives.
2. For ANY figure you state, call query_table and read the exact value. Never
   transcribe a number out of prose, and never compute one that is not printed.
3. Filings get restated. If two filings cover the same entity and period, the
   one with the later as-of date wins. query_table already applies this.
4. If the corpus does not contain the answer, say so plainly and call
   list_sources to show what IS covered. Guessing is worse than not answering.

How to cite:
Every sentence containing a figure must end with a citation of the form
[docId p.N] naming the filing and page you read it from. An answer with a
figure and no citation is not acceptable.`;

/**
 * The agent loop.
 *
 * Shared between the CLI and the eval on purpose: W3's agent tier drives this
 * exact function, so a passing eval is evidence about the thing users run,
 * not about a parallel implementation that has since drifted.
 */
export async function answerQuestion(
  ctx: AgentContext<unknown>,
  question: string,
): Promise<AnswerResult> {
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: question },
  ];

  const toolSchemas = TOOLS.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    input_schema: toJsonSchema(t),
  }));

  let turns = 0;

  for (let i = 0; i < 12; i++) {
    const response = await ctx.llm.complete({
      // The wrapper wants the conversation for its own bookkeeping; the actual
      // provider call happens in `call`, which it memoizes as a durable step.
      messages,
      tools: toolSchemas,
      call: async () => {
        const message = await anthropic.messages.create({
          model: "claude-opus-5",
          max_tokens: 4000,
          system: SYSTEM,
          tools: toolSchemas as Anthropic.Tool[],
          messages,
        });
        return {
          content: message.content,
          toolCalls: message.content
            .filter((c): c is Anthropic.ToolUseBlock => c.type === "tool_use")
            .map((c) => ({ name: c.name, input: c.input })),
          finishReason: message.stop_reason ?? undefined,
        };
      },
    });
    turns = ctx.turn;

    // `content` is the memoized assistant blocks, so this replays correctly on
    // resume rather than re-calling the provider.
    const blocks = response.content as Anthropic.ContentBlock[];
    messages.push({ role: "assistant", content: blocks });

    const toolUses = blocks.filter(
      (c): c is Anthropic.ToolUseBlock => c.type === "tool_use",
    );

    if (toolUses.length === 0) {
      const text = blocks
        .filter((c): c is Anthropic.TextBlock => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      return gate(text, turns);
    }

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      // ctx.tool memoizes each call as a durable step, so a crash mid-loop
      // does not re-run a tool that already answered.
      const output = await ctx.tool(use.name, use.input);
      results.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: JSON.stringify(output),
      });
    }
    messages.push({ role: "user", content: results });
  }

  return gate("", turns);
}

/**
 * The citation gate.
 *
 * An answer that states a figure without saying where it came from is refused,
 * not returned with a warning. In finance an uncited number is worse than no
 * number: it looks authoritative and cannot be checked.
 */
export function gate(text: string, turns: number): AnswerResult {
  const citations = [...text.matchAll(CITATION_RE)].map((m) => ({
    docId: m[1]!,
    page: Number(m[2]),
  }));

  const statesFigure = FIGURE_RE.test(stripCitations(text));
  const refused = statesFigure && citations.length === 0;

  return { answer: text, citations, refused, turns };
}

/** Citations contain digits; counting them as figures would defeat the gate. */
export function stripCitations(text: string): string {
  return text.replace(CITATION_RE, "");
}

/** Zod -> JSON Schema for the tool wire format. Built in to zod 4. */
function toJsonSchema(tool: (typeof TOOLS)[number]): unknown {
  return z.toJSONSchema(tool.input, { io: "input" });
}
