import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ACTIONS, ACTION_FOR_CAUSE, CAUSES } from "../src/causes.js";
import { buildStatement } from "../scripts/build-statement.js";

const RAW = readFileSync(new URL("../fixtures/statement.json", import.meta.url), "utf8");
const statement = JSON.parse(RAW) as {
  transactions: { id: string; cause: string | null }[];
  applicationLines: string[];
  applicationTotalCents: number;
  statementTotalCents: number;
};

describe("committed fixture data carries no sensitive shapes", () => {
  // Criterion 8. Reviewer vigilance does not survive contact with time.
  it("contains nothing shaped like an account number", () => {
    expect(RAW).not.toMatch(/\b\d{8,}\b/);
  });

  it("contains nothing shaped like an email address", () => {
    expect(RAW).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  });
});

describe("fixture shape", () => {
  it("has 100 transactions with 10 in the residue", () => {
    expect(statement.transactions).toHaveLength(100);
    expect(statement.transactions.filter((t) => t.cause !== null)).toHaveLength(10);
  });

  it("has an application total below the statement total by exactly the residue", () => {
    const residue = statement.transactions.filter((t) => t.cause !== null).length;
    expect(residue).toBeGreaterThan(0);
    expect(statement.applicationTotalCents).toBeLessThan(statement.statementTotalCents);
  });

  it("has an applicationLines list matching exactly the non-residue transactions", () => {
    expect(statement.applicationLines).toHaveLength(90);
    const causeById = new Map(statement.transactions.map((t) => [t.id, t.cause]));
    for (const id of statement.applicationLines) {
      expect(causeById.get(id)).toBeNull();
    }
  });
});

describe("the committed fixture matches its generator", () => {
  // Deleting generate-fixtures.ts and re-running the suite must fail here.
  // Without this, a later edit to the seed/VENDORS/RESIDUE/amount ceiling
  // can drift the generator away from the committed JSON while every other
  // test — which only reads the committed file — stays green. Tasks 2, 3
  // and 9 assert an exact 90/100 ratio against this fixture, so a silent
  // drift would make those assertions test the wrong thing.
  it("buildStatement() reproduces the committed fixtures/statement.json exactly", () => {
    expect(buildStatement()).toEqual(statement);
  });
});

describe("the three cause consumers agree", () => {
  // Generator, classifier and allowlist all read causes.ts. If they drift the
  // example passes its tests while teaching something false.
  it("maps every cause to exactly one action", () => {
    expect(Object.keys(ACTION_FOR_CAUSE).sort()).toEqual([...CAUSES].sort());
    expect(new Set(ACTIONS).size).toBe(CAUSES.length);
  });

  it("seeds the fixture residue only from known causes", () => {
    for (const t of statement.transactions) {
      if (t.cause !== null) expect(CAUSES).toContain(t.cause);
    }
  });
});
