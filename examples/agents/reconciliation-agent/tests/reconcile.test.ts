import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { learnRule, reconcile, ruleKey } from "../src/reconcile.js";
import type { Statement } from "../src/reconcile.js";

const statement = JSON.parse(
  readFileSync(new URL("../fixtures/statement.json", import.meta.url), "utf8"),
) as Statement;

describe("deterministic reconciliation", () => {
  // Criterion 1: the deterministic pass must be load-bearing, not decorative.
  // Without this assertion a later refactor can route everything to the model
  // and every other test still passes.
  it("matches at least 85% of transactions with no model involved", () => {
    const result = reconcile(statement);
    expect(result.matchedRatio).toBeGreaterThanOrEqual(0.85);
    expect(result.matched).toHaveLength(90);
  });

  it("groups the residue into per-counterparty clusters", () => {
    const result = reconcile(statement);
    const escalated = result.clusters.flatMap((c) => c.transactions);
    expect(escalated).toHaveLength(10);
    const counterparties = result.clusters.map((c) => c.counterparty);
    expect(new Set(counterparties).size).toBe(counterparties.length);
  });

  it("derives a stable caseId from the period and counterparty", () => {
    const a = reconcile(statement);
    const b = reconcile(statement);
    expect(a.clusters.map((c) => c.caseId)).toEqual(b.clusters.map((c) => c.caseId));
  });

  // caseId is the correlation key for waitForEvent, the operational
  // projection, and learnRule — a collision cross-wires two counterparties'
  // cases. The slug alone is not injective ("Vendor A" / "Vendor-A" /
  // "Vendor.A" all reduce to "vendor-a"), so caseIdFor must disambiguate.
  it("gives distinct caseIds to distinct counterparties whose slugs collide", () => {
    const colliding: Statement = {
      periodStart: "2026-09-01",
      transactions: [
        { id: "t1", counterparty: "Vendor A", amountCents: 1000, currency: "USD", dayOffset: 0, label: "ADJ-0001", cause: null },
        { id: "t2", counterparty: "Vendor-A", amountCents: 2000, currency: "USD", dayOffset: 0, label: "ADJ-0002", cause: null },
      ],
      applicationLines: [],
      applicationTotalCents: 0,
      statementTotalCents: 3000,
    };
    const result = reconcile(colliding);
    expect(result.clusters).toHaveLength(2);
    const [a, b] = result.clusters;
    expect(a!.caseId).not.toBe(b!.caseId);
  });

  // The disambiguator must not over-correct: two transactions from the SAME
  // counterparty still belong to one cluster with one caseId.
  it("keeps one counterparty in one cluster with one caseId", () => {
    const same: Statement = {
      periodStart: "2026-09-01",
      transactions: [
        { id: "t1", counterparty: "Vendor A", amountCents: 1000, currency: "USD", dayOffset: 0, label: "ADJ-0001", cause: null },
        { id: "t2", counterparty: "Vendor A", amountCents: 2000, currency: "USD", dayOffset: 0, label: "ADJ-0002", cause: null },
      ],
      applicationLines: [],
      applicationTotalCents: 0,
      statementTotalCents: 3000,
    };
    const result = reconcile(same);
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]!.transactions).toHaveLength(2);
  });
});

describe("learned rules", () => {
  it("keys a rule deterministically from counterparty and predicate", () => {
    const predicate = { kind: "label-prefix", prefix: "ADJ-" } as const;
    // Two concurrent runs learning the same thing must converge on one key.
    expect(ruleKey("Vendor A", predicate)).toBe(ruleKey("Vendor A", predicate));
    expect(ruleKey("Vendor A", predicate)).not.toBe(ruleKey("Vendor B", predicate));
  });

  it("resolves a known pattern without escalating it", () => {
    const before = reconcile(statement);
    const cluster = before.clusters[0]!;
    const rule = learnRule({
      counterparty: cluster.counterparty,
      predicate: { kind: "label-prefix", prefix: "ADJ-" },
      actionId: "reassign-to-sibling",
      learnedAt: "2026-09-09T00:00:00.000Z",
    });

    const after = reconcile(statement, [rule]);

    // The whole point: the second occurrence never reaches the model, and the
    // deterministic ratio goes UP because of it.
    expect(after.matchedRatio).toBeGreaterThan(before.matchedRatio);
    expect(after.clusters.map((c) => c.counterparty)).not.toContain(cluster.counterparty);
    expect(after.rulesApplied).toContain(rule.key);
  });
});
