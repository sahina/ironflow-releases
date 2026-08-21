import { NonRetryableError } from "@ironflow/node";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  aggregate,
  loadGolden,
  normaliseFigure,
  numericMatch,
  passesGate,
  retrievalMatch,
} from "../src/scoring.js";
import { FILINGS } from "../scripts/seed-corpus.js";

describe("normaliseFigure", () => {
  test("strips separators and currency", () => {
    expect(normaliseFigure("$1,284,000")).toBe("1284000");
    expect(normaliseFigure("1284000")).toBe("1284000");
  });

  test("treats a trailing .0 as the same number", () => {
    expect(normaliseFigure("1284000.0")).toBe(normaliseFigure("1284000"));
  });

  test("returns empty for something that is not a figure", () => {
    expect(normaliseFigure("n/a")).toBe("");
    expect(normaliseFigure("")).toBe("");
  });
});

describe("numericMatch", () => {
  test("finds the figure regardless of formatting in the answer", () => {
    expect(numericMatch("Revenue was $1,251,000 [d p.2]", "1251000")).toBe(true);
    expect(numericMatch("Revenue was 1251000 [d p.2]", "1251000")).toBe(true);
  });

  test("rejects the superseded figure — the restatement case", () => {
    // The original filing said 1,284,000. Answering that is WRONG, and this is
    // the assertion that catches a broken supersession rule.
    expect(numericMatch("Revenue was $1,284,000 [d p.2]", "1251000")).toBe(
      false,
    );
  });

  test("does not match a number that merely contains the target digits", () => {
    expect(numericMatch("Revenue was 11251000", "1251000")).toBe(false);
  });

  test("is false when the answer states no figure at all", () => {
    expect(numericMatch("I do not know.", "1251000")).toBe(false);
  });

  test("does not pass an answer that names the figure only to reject it", () => {
    // The false-pass that matters most here: the grader sees the digits and
    // scores a pass, but the answer asserts the opposite. A wrong figure that
    // scores as correct is exactly what the eval exists to prevent.
    expect(
      numericMatch("It was not 1,251,000; the correct value is 1,284,000.", "1251000"),
    ).toBe(false);
  });

  test("a lone digit in the answer does not satisfy a single-digit expectation", () => {
    // The regex has a bare `\d` alternative, so any stray digit anywhere —
    // a page number, a footnote marker, a year fragment — could satisfy a
    // short expected value.
    expect(numericMatch("See note 4 on page 7.", "7")).toBe(false);
  });
});

describe("retrievalMatch", () => {
  test("passes when the needed document was retrieved", () => {
    expect(retrievalMatch(["a", "b"], "b")).toBe(true);
  });

  test("fails when it was not", () => {
    expect(retrievalMatch(["a"], "b")).toBe(false);
  });
});

describe("aggregate", () => {
  test("counts each tier and lists every failing id", () => {
    const scores = aggregate([
      { id: "a", retrievalPassed: true, numericPassed: true, judged: 1 },
      { id: "b", retrievalPassed: true, numericPassed: false, judged: 0 },
      { id: "c", retrievalPassed: false, numericPassed: true, judged: 0.5 },
    ]);
    expect(scores.numericPassed).toBe(2);
    expect(scores.retrievalPassed).toBe(2);
    expect(scores.judgedMean).toBeCloseTo(0.5);
    expect(scores.failing).toEqual(["b", "c"]);
  });

  test("an empty run does not divide by zero", () => {
    expect(aggregate([]).judgedMean).toBe(0);
  });
});

describe("passesGate", () => {
  const base = {
    retrievalPassed: 0,
    retrievalTotal: 0,
    judgedMean: 0,
    failing: [],
  };

  test("passes at or above the threshold", () => {
    expect(passesGate({ ...base, numericPassed: 9, numericTotal: 10 })).toBe(
      true,
    );
  });

  test("blocks below it", () => {
    expect(passesGate({ ...base, numericPassed: 8, numericTotal: 10 })).toBe(
      false,
    );
  });

  test("an eval that scored nothing does NOT promote", () => {
    // The dangerous default: zero questions must never read as 100% passing,
    // or a broken golden-set load would silently promote every index.
    expect(passesGate({ ...base, numericPassed: 0, numericTotal: 0 })).toBe(
      false,
    );
  });
});

describe("golden set", () => {
  test("loads and every row has an id and a question", async () => {
    const rows = await loadGolden("evals/golden.yaml");
    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) {
      expect(row.id).toBeTruthy();
      expect(row.question).toBeTruthy();
    }
  });

  test("ids are unique", async () => {
    const rows = await loadGolden("evals/golden.yaml");
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });

  test("every expected figure matches the authored corpus", async () => {
    // This is the test that keeps the golden set honest. The corpus generator
    // owns the numbers; if someone edits a figure in one place and not the
    // other, the eval would be scoring against fiction and this fails.
    const rows = await loadGolden("evals/golden.yaml");
    const restated = FILINGS.find((f) => f.label === "restated")!;
    const current = new Map(
      restated.rows.map((r) => [r[0], normaliseFigure(r[1])]),
    );
    const priorYear = new Map(
      restated.rows.map((r) => [r[0], normaliseFigure(r[2])]),
    );

    const known = [...current.values(), ...priorYear.values()];
    for (const row of rows) {
      if (!row.expectedValue) continue;
      expect(
        known,
        `golden row "${row.id}" expects ${row.expectedValue}, which no longer appears in the generated corpus`,
      ).toContain(normaliseFigure(row.expectedValue));
    }
  });

  test("the restatement row expects the NEW figure, not the original", async () => {
    const rows = await loadGolden("evals/golden.yaml");
    const revenue = rows.find((r) => r.id === "revenue-restated")!;
    const original = FILINGS.find((f) => f.label === "original")!;
    const originalRevenue = normaliseFigure(
      original.rows.find((r) => r[0] === "Total revenue")![1],
    );
    expect(normaliseFigure(revenue.expectedValue!)).not.toBe(originalRevenue);
  });
});

describe("loadGolden rejects malformed input without retrying", () => {
  // NonRetryableError specifically, not just "it throws": run-eval loads the
  // golden set inside step.run, so a plain Error costs three attempts and buries
  // the reason. Asserting only toThrow() would pass with the retryable version.
  const write = async (body: string) => {
    const p = join(await mkdtemp(join(tmpdir(), "golden-")), "golden.yaml");
    await writeFile(p, body);
    return p;
  };

  test("a document that is not a list", async () => {
    await expect(loadGolden(await write("id: not-a-list\n"))).rejects.toBeInstanceOf(
      NonRetryableError,
    );
  });

  test("a row missing id or question", async () => {
    await expect(
      loadGolden(await write("- question: has no id\n  expectedValue: '1'\n")),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });

  test("a null row — a stray dash in the YAML", async () => {
    await expect(loadGolden(await write("- \n"))).rejects.toBeInstanceOf(
      NonRetryableError,
    );
  });

  test("expectedContains given as a string instead of a list", async () => {
    await expect(
      loadGolden(await write("- id: s\n  question: q\n  expectedContains: text\n")),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });

  test("a row that cannot fail — no expectedValue, no expectedContains", async () => {
    await expect(
      loadGolden(await write("- id: vacuous\n  question: q\n")),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });
});
