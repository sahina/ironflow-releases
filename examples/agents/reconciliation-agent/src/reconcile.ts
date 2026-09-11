import { createHash } from "node:crypto";
import type { Cause } from "./causes.js";

export interface Transaction {
  id: string;
  counterparty: string;
  amountCents: number;
  currency: "USD";
  dayOffset: number;
  label: string;
  cause: Cause | null;
}

export interface Statement {
  periodStart: string;
  transactions: Transaction[];
  applicationLines: string[];
  applicationTotalCents: number;
  statementTotalCents: number;
}

export interface Cluster {
  caseId: string;
  counterparty: string;
  transactions: Transaction[];
  deltaCents: number;
}

export interface ReconcileResult {
  matched: Transaction[];
  clusters: Cluster[];
  matchedRatio: number;
  rulesApplied: string[];
}

// A transaction matches deterministically when the application actually
// booked it. In a real deployment this is where invoice-number and
// amount+date matching against the ledger lives.
function matchesDeterministically(t: Transaction, booked: Set<string>): boolean {
  return booked.has(t.id);
}

// The predicate grammar is CLOSED and written by a human. A confirmed
// resolution supplies PARAMETERS into one of these; it never widens the
// grammar. The model proposes, a person authorizes, and no model output is
// ever executable.
export type Predicate =
  | { kind: "label-prefix"; prefix: string }
  | { kind: "amount-tolerance"; amountCents: number; toleranceCents: number }
  | { kind: "date-window"; dayOffset: number; windowDays: number };

export interface LearnedRule {
  key: string;
  counterparty: string;
  predicate: Predicate;
  actionId: string;
  learnedAt: string;
}

// Deterministic key over counterparty + predicate. Two concurrent case runs
// learning the same rule converge on one entry.
export function ruleKey(counterparty: string, predicate: Predicate): string {
  const canonical = JSON.stringify([counterparty, predicate.kind, Object.entries(predicate).sort()]);
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

export function learnRule(input: {
  counterparty: string;
  predicate: Predicate;
  actionId: string;
  learnedAt: string;
}): LearnedRule {
  return { key: ruleKey(input.counterparty, input.predicate), ...input };
}

function predicateMatches(p: Predicate, t: Transaction): boolean {
  switch (p.kind) {
    case "label-prefix":
      return t.label.startsWith(p.prefix);
    case "amount-tolerance":
      return Math.abs(t.amountCents - p.amountCents) <= p.toleranceCents;
    case "date-window":
      return Math.abs(t.dayOffset - p.dayOffset) <= p.windowDays;
  }
}

function ruleFor(rules: LearnedRule[], t: Transaction): LearnedRule | undefined {
  return rules.find((r) => r.counterparty === t.counterparty && predicateMatches(r.predicate, t));
}

// Stable and human-readable for operators and correlation; embeds the counterparty
// name. Must never be passed to a model. Derived rather than generated so a replay
// produces the same ids.
//
// Slugified to [a-z0-9-] only — counterparty is external statement data, any
// string. A quote or CEL metacharacter in a raw id would break or widen the
// waitForEvent match filter built from it in agent.ts, corrupt the
// operational projection key, and break operator scripts that take a caseId
// on the command line. Restricting the charset at the source fixes it for
// every consumer, not just the match filter (which also escapes, belt and
// braces — see agent.ts).
//
// The slug alone is not injective: "Vendor A", "Vendor-A", "Vendor.A" and
// "vendor a" all reduce to the same slug, so two distinct counterparties
// could otherwise land on one caseId — and every consumer above correlates
// on caseId, so a collision cross-wires two cases (one counterparty's reply
// resolves the other's, learnRule attributes the confirmed action to the
// wrong counterparty). A short hash suffix over the RAW (unslugified)
// counterparty restores injectivity while keeping the slug as the
// human-readable prefix. Not a numeric disambiguator: that would depend on
// cluster iteration order, breaking the replay determinism this example
// exists to demonstrate.
function caseIdFor(periodStart: string, counterparty: string): string {
  const slug = counterparty
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const disambiguator = createHash("sha256").update(counterparty).digest("hex").slice(0, 8);
  return `case-${periodStart}-${slug}-${disambiguator}`;
}

export function reconcile(statement: Statement, rules: LearnedRule[] = []): ReconcileResult {
  const booked = new Set(statement.applicationLines);
  const matched: Transaction[] = [];
  const residue: Transaction[] = [];
  const rulesApplied = new Set<string>();

  for (const t of statement.transactions) {
    if (matchesDeterministically(t, booked)) {
      matched.push(t);
      continue;
    }
    const rule = ruleFor(rules, t);
    if (rule) {
      // A previously confirmed, human-authorized resolution. Never escalated.
      matched.push(t);
      rulesApplied.add(rule.key);
      continue;
    }
    residue.push(t);
  }

  const byCounterparty = new Map<string, Transaction[]>();
  for (const t of residue) {
    const existing = byCounterparty.get(t.counterparty) ?? [];
    existing.push(t);
    byCounterparty.set(t.counterparty, existing);
  }

  const clusters: Cluster[] = [...byCounterparty.entries()]
    .map(([counterparty, transactions]) => ({
      caseId: caseIdFor(statement.periodStart, counterparty),
      counterparty,
      transactions,
      deltaCents: transactions.reduce((n, t) => n + t.amountCents, 0),
    }))
    .sort((a, b) => a.caseId.localeCompare(b.caseId));

  return {
    matched,
    clusters,
    matchedRatio: matched.length / statement.transactions.length,
    rulesApplied: [...rulesApplied],
  };
}
