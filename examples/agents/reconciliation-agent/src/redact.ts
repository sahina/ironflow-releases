import { createHash } from "node:crypto";
import type { Cluster } from "./reconcile.js";

// ── The model boundary ─────────────────────────────────────────
//
// Everything the model sees passes through here. This lives in application
// code, not in the engine: Ironflow's CEL policy layer is deny-only,
// subtractive, and not yet wired into the live evaluator, so it cannot
// redact fields. See the design doc §2.2. Do not read this file as a
// gesture at an engine capability that exists.
// ────────────────────────────────────────────────────────────────

export interface RedactedCase {
  counterpartyRef: string;
  lines: { amountCents: number; currency: string; dayOffset: number; labelShape: string }[];
  deltaCents: number;
}

function pseudonym(counterparty: string): string {
  return `cp_${createHash("sha256").update(counterparty).digest("hex").slice(0, 12)}`;
}

// "ADJ-0090" -> "ADJ-<n>". The shape is what the matcher reasons about; the
// digits are an identifier and stay behind the boundary.
function labelShape(label: string): string {
  const match = /^(ADJ|INV)-[0-9]+$/.exec(label);
  return match ? `${match[1]}-<n>` : "unknown";
}

export function redactCluster(cluster: Cluster, _periodStart: string): RedactedCase {
  return {
    counterpartyRef: pseudonym(cluster.counterparty),
    deltaCents: cluster.deltaCents,
    lines: cluster.transactions.map((t) => ({
      amountCents: t.amountCents,
      currency: t.currency,
      dayOffset: t.dayOffset,
      labelShape: labelShape(t.label),
    })),
  };
}

// The reply body is the primary prompt-injection vector. It is classified by
// keyword here and the model sees only the classification — never the prose.
// This costs realism and buys the threat note its teeth.
const REPLY_PATTERNS: [RegExp, string][] = [
  [/sibling|other account|different account/i, "posted-elsewhere"],
  [/next month|next period|timing/i, "timing"],
  [/partial|instal|balance/i, "partial"],
  [/fee|charge deducted|withheld/i, "fee"],
  [/duplicate|twice|double/i, "duplicate"],
];

export function redactReply(body: string): { classification: string } {
  for (const [pattern, classification] of REPLY_PATTERNS) {
    if (pattern.test(body)) return { classification };
  }
  return { classification: "unclear" };
}
