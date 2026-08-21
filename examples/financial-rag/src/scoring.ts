import { NonRetryableError } from "@ironflow/node";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";

export interface GoldenRow {
  id: string;
  question: string;
  /** The exact figure the answer must state, digits only. Optional for prose questions. */
  expectedValue?: string;
  /** A docId that MUST appear in retrieval for this question to be answerable. */
  expectedDoc?: string;
  /** Substrings the answer must contain. Used for non-numeric questions. */
  expectedContains?: string[];
  notes?: string;
}

export interface QuestionResult {
  id: string;
  retrievalPassed: boolean;
  numericPassed: boolean;
  judged: number;
}

export interface Scores {
  retrievalPassed: number;
  retrievalTotal: number;
  numericPassed: number;
  numericTotal: number;
  judgedMean: number;
  failing: string[];
}

/**
 * Load and validate the golden set. A malformed row is a hard error.
 *
 * NonRetryableError throughout: run-eval loads this inside step.run, and a
 * golden set that is malformed on attempt 1 is malformed on attempt 3. Retrying
 * only delays the failure and hides the reason behind two more attempts.
 */
export async function loadGolden(path: string): Promise<GoldenRow[]> {
  const raw = parse(await readFile(path, "utf8")) as unknown;
  if (!Array.isArray(raw)) {
    throw new NonRetryableError(`golden set at ${path} must be a YAML list`);
  }
  return raw.map((row, i) => {
    // Shape first, or the checks below are the ones that throw: a null row (a
    // stray `-` in the YAML) makes `r.id` a TypeError, and a string
    // expectedContains satisfies `.length` then dies on `.every()` at scoring
    // time. Both are retryable, which is exactly what this function promises
    // not to raise.
    if (typeof row !== "object" || row === null) {
      throw new NonRetryableError(`golden row ${i} is not a mapping`);
    }
    const r = row as Partial<GoldenRow>;
    if (!r.id || !r.question) {
      throw new NonRetryableError(`golden row ${i} is missing id or question`);
    }
    if (r.expectedContains !== undefined && !Array.isArray(r.expectedContains)) {
      throw new NonRetryableError(
        `golden row "${r.id}" has a non-list expectedContains`,
      );
    }
    // A row with no expectation scores a vacuous pass ([].every() is true),
    // silently inflating the gate. Reject it at load rather than at scoring.
    if (!r.expectedValue && !(r.expectedContains ?? []).length) {
      throw new NonRetryableError(
        `golden row "${r.id}" has neither expectedValue nor expectedContains — it cannot fail, so it must not count`,
      );
    }
    return r as GoldenRow;
  });
}

/**
 * Normalise a figure for comparison.
 *
 * "1,284,000", "1284000" and "$1,284,000" are the same number. Currency symbols
 * and separators are presentation; the digits are the fact. Without this the
 * numeric tier fails on formatting and tells you nothing about extraction.
 */
export function normaliseFigure(v: string): string {
  const cleaned = v.replace(/[^0-9.-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return "";
  // Drop a trailing ".0" so 1284000 and 1284000.0 compare equal.
  const n = Number(cleaned);
  return Number.isFinite(n) ? String(n) : "";
}

/** A figure preceded by any of these is a reference, not an asserted value. */
const REFERENCE_BEFORE = /\b(?:page|p|pp|note|notes|section|item|footnote|line|table|figure|fig)\.?\s*$/i;

/** A figure preceded by any of these is being denied, not asserted. */
const NEGATION_BEFORE = /\b(?:not|isn'?t|wasn'?t|never|rather than|instead of|no longer|incorrectly|erroneously)\b[^.;]{0,24}$/i;

/**
 * Did the answer ASSERT the expected figure?
 *
 * Not "do the digits appear somewhere" — that scores
 * "It was not 1,251,000, the correct value is 1,284,000" as a pass, which is
 * the worst possible failure for a grader whose whole job is catching wrong
 * numbers. Two guards, both looking at what precedes the match:
 *
 *  - a reference word (page 7, note 4) means the digits are a pointer, not a value
 *  - a negation means the answer is denying the figure, not stating it
 *
 * ponytail: two regex guards, not semantics. A model judge would read the
 * sentence properly; this catches the cheap cases without a model call. If
 * false passes survive, that is the upgrade — see the agent tier in run-eval.
 */
export function numericMatch(answer: string, expected: string): boolean {
  const target = normaliseFigure(expected);
  if (target === "") return false;

  const pattern = /[$]?\d[\d,._]*/g;
  for (const match of answer.matchAll(pattern)) {
    if (normaliseFigure(match[0]) !== target) continue;
    const before = answer.slice(0, match.index);
    if (REFERENCE_BEFORE.test(before)) continue;
    if (NEGATION_BEFORE.test(before)) continue;
    return true;
  }
  return false;
}

/** Did retrieval surface the document the answer needs? */
export function retrievalMatch(docIds: string[], expectedDoc: string): boolean {
  return docIds.includes(expectedDoc);
}

/** Aggregate per-question results into the verdict the workflow emits. */
export function aggregate(results: QuestionResult[]): Scores {
  const retrievalTotal = results.length;
  const numericTotal = results.length;
  const judged = results.map((r) => r.judged);
  return {
    retrievalPassed: results.filter((r) => r.retrievalPassed).length,
    retrievalTotal,
    numericPassed: results.filter((r) => r.numericPassed).length,
    numericTotal,
    judgedMean:
      judged.length === 0
        ? 0
        : judged.reduce((a, b) => a + b, 0) / judged.length,
    failing: results
      .filter((r) => !r.numericPassed || !r.retrievalPassed)
      .map((r) => r.id),
  };
}

/**
 * The promotion gate.
 *
 * Numeric is the tier that decides. A retrieval regression with numbers still
 * correct is worth knowing about but does not block; a wrong figure does.
 */
export function passesGate(scores: Scores, threshold = 0.9): boolean {
  if (scores.numericTotal === 0) return false;
  return scores.numericPassed / scores.numericTotal >= threshold;
}
