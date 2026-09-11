import { CAUSES } from "../src/causes.js";
import type { Statement, Transaction } from "../src/reconcile.js";

// Seeded LCG. A fixture that changes between runs makes the 90/10 ratio
// assertion flaky and the crash demo unreproducible.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const VENDORS = ["Vendor A", "Vendor B", "Vendor C", "Vendor D", "Vendor E"];
const TOTAL = 100;
const RESIDUE = 10;

// Pure and deterministic — same seed always produces the same statement.
// tests/fixtures.test.ts calls this directly and deep-equals it against the
// committed fixtures/statement.json, so a generator edit that isn't
// re-committed to the fixture fails the suite instead of staying silent.
export function buildStatement(): Statement {
  const rand = lcg(20260909);
  const transactions: Transaction[] = [];
  for (let i = 0; i < TOTAL; i++) {
    const residual = i >= TOTAL - RESIDUE;
    const cause = residual ? CAUSES[(i - (TOTAL - RESIDUE)) % CAUSES.length]! : null;
    transactions.push({
      id: `TXN-${String(i + 1).padStart(4, "0")}`,
      counterparty: VENDORS[Math.floor(rand() * VENDORS.length)]!,
      amountCents: 1000 + Math.floor(rand() * 150000),
      currency: "USD",
      dayOffset: Math.floor(rand() * 28),
      label: residual ? `ADJ-${String(i).padStart(4, "0")}` : `INV-${String(i).padStart(4, "0")}`,
      cause,
    });
  }

  const statementTotalCents = transactions.reduce((n, t) => n + t.amountCents, 0);
  // The application's own total omits the residue — that gap is the exception.
  const applicationTotalCents = transactions
    .filter((t) => t.cause === null)
    .reduce((n, t) => n + t.amountCents, 0);
  // The transaction ids the application actually booked. Task 2's matcher
  // tests membership here rather than reading the generator's `cause` field
  // directly — that would make the matcher grade against its own answer key.
  const applicationLines = transactions.filter((t) => t.cause === null).map((t) => t.id);

  return { periodStart: "2026-09-01", transactions, applicationLines, applicationTotalCents, statementTotalCents };
}
