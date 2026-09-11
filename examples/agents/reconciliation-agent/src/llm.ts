// Provider-agnostic LLM closure consumed by ctx.llm.complete().
//
// The agent module is anti-scope on provider routing: callers bring their own
// SDK and pass the call as a closure. The wrapper memoizes its return value.
//
// Swap triageWith() for the real provider. Reference implementation:
//
//   import Anthropic from "@anthropic-ai/sdk";
//   const client = new Anthropic();
//
//   export async function triageWith(input: RedactedCase): Promise<LLMCompleteResult> {
//     const r = await client.messages.create({
//       model: "claude-opus-4-5",
//       max_tokens: 256,
//       messages: [{ role: "user", content: JSON.stringify(input) }],
//     });
//     return { content: JSON.parse(textOf(r)), finishReason: r.stop_reason ?? undefined };
//   }
//
// Note what is NOT returned: no raw provider payload, no free text, no usage
// blob. Only what a replay needs (criterion 7).

import { NonRetryableError } from "@ironflow/node";
import type { LLMCompleteResult } from "@ironflow/node/agent";
import { ACTIONS, ACTION_FOR_CAUSE, CAUSES, type Cause } from "./causes.js";
import type { RedactedCase } from "./redact.js";

export interface Triage {
  classification: Cause;
  confidence: number;
  proposedActionId: string;
}

// Two lines booked for the same amount on the same day, within one case —
// the shape a duplicate post leaves behind.
function hasDuplicateLine(lines: RedactedCase["lines"]): boolean {
  return lines.some((a, i) => lines.some((b, j) => j > i && a.amountCents === b.amountCents && a.dayOffset === b.dayOffset));
}

// Deterministic stand-in for the provider. Derives a cause from the redacted
// shape alone — it has no access to the seeded cause, so it is doing the same
// job a real model would.
export async function triageWith(input: RedactedCase): Promise<LLMCompleteResult> {
  const line = input.lines[0];
  let classification: Cause = "timing-next-period";
  if (line) {
    if (line.labelShape.startsWith("ADJ-")) classification = "posted-to-sibling-account";
    if (line.amountCents < 5000) classification = "fee-deducted-at-source";
    if (input.lines.length > 1) classification = "partial-payment";
    // Duplicate is a more specific case of "more than one line" and must run
    // after the partial-payment check above to win over it — not before.
    if (hasDuplicateLine(input.lines)) classification = "duplicate-posting";
  }
  return {
    content: {
      classification,
      confidence: 0.82,
      proposedActionId: ACTION_FOR_CAUSE[classification],
    },
    finishReason: "stop",
  };
}

// Structured-output-only, then an allowlist check. Injected text has no
// channel to act through: it cannot become an action id that is not already
// on this list, and the list is written by a human in causes.ts.
export function parseTriage(result: LLMCompleteResult): Triage {
  const c = result.content;
  if (typeof c !== "object" || c === null) {
    throw new NonRetryableError("triage result is not structured output");
  }
  const { classification, confidence, proposedActionId } = c as Record<string, unknown>;
  if (typeof classification !== "string" || !CAUSES.includes(classification as Cause)) {
    throw new NonRetryableError(`triage classification is not a known cause: ${String(classification)}`);
  }
  if (typeof proposedActionId !== "string" || !ACTIONS.includes(proposedActionId)) {
    throw new NonRetryableError(`triage proposal is not on the action allowlist: ${String(proposedActionId)}`);
  }
  return {
    classification: classification as Cause,
    confidence: typeof confidence === "number" ? confidence : 0,
    proposedActionId,
  };
}
