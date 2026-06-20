// Provider-agnostic LLM closure consumed by ctx.llm.complete().
//
// The agent module is anti-scope on provider routing: callers bring
// their own SDK and pass the call as a closure. The wrapper memoizes
// the closure's return value as a step.
//
// Swap reviewWith() for the real provider (Anthropic, OpenAI, etc).
// Reference implementation:
//
//   import Anthropic from "@anthropic-ai/sdk";
//   const client = new Anthropic();
//
//   export async function reviewWith(diff: string) {
//     const r = await client.messages.create({
//       model: "claude-opus-4-5",
//       max_tokens: 512,
//       messages: [{
//         role: "user",
//         content: `Review this diff:\n${diff}`,
//       }],
//     });
//     const text = r.content
//       .filter((b) => b.type === "text")
//       .map((b) => (b as { text: string }).text)
//       .join("\n");
//     return {
//       content: text,
//       finishReason: r.stop_reason ?? undefined,
//       metadata: { usage: r.usage },
//     };
//   }

import type { LLMCompleteResult } from "@ironflow/node/agent";

export async function reviewWith(diff: string): Promise<LLMCompleteResult> {
  await new Promise((r) => setTimeout(r, 300));
  const findings = analyseDiff(diff);
  return {
    content: findings.summary,
    finishReason: "stop",
    metadata: { findings },
  };
}

function analyseDiff(diff: string): {
  summary: string;
  severity: "low" | "medium" | "high";
} {
  if (diff.includes("== ") && !diff.includes("===")) {
    return {
      summary:
        "⚠ Found a loose equality (==). Recommend strict equality (===) " +
        "to avoid type-coercion bugs in auth comparisons.",
      severity: "high",
    };
  }
  return {
    summary: "Diff looks reasonable. No high-severity issues spotted.",
    severity: "low",
  };
}
