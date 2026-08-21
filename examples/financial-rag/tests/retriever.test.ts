import { describe, expect, test } from "vitest";
import { supersede, type TableRow } from "../src/retriever.js";
import { gate, stripCitations } from "../src/agent.js";
import { localEmbedding, EMBEDDING_DIM } from "../src/embed.js";

const row = (over: Partial<TableRow>): TableRow => ({
  docId: "d",
  tableId: "t1",
  entity: "ACME",
  period: "2024-Q3",
  label: "Total revenue",
  value: "1284000",
  unit: "USD thousands",
  page: 2,
  asOf: "2024-11-01",
  ...over,
});

describe("supersede", () => {
  test("keeps only the newest filing's figure for a restated row", () => {
    const kept = supersede([
      row({ asOf: "2024-11-01", value: "1284000" }),
      row({ asOf: "2025-02-14", value: "1251000" }),
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.value).toBe("1251000");
  });

  test("supersedes across filings even though tableId differs", () => {
    // THE bug this file previously hid. tableId comes from the extraction
    // schema — the model invents it, per filing, in a separate parse run. The
    // original and the restatement are parsed independently, so their tableIds
    // do not match. Keying on tableId means neither row supersedes the other
    // and `query_table` returns BOTH the old and the restated figure.
    //
    // The old fixture hardcoded tableId:"t1" on both rows, which is exactly the
    // condition that made the broken key look correct.
    const kept = supersede([
      row({ docId: "acme-orig", tableId: "tbl-ops-1", asOf: "2024-11-01", value: "1284000" }),
      row({ docId: "acme-restated", tableId: "income-statement", asOf: "2025-02-14", value: "1251000" }),
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.value).toBe("1251000");
  });

  test("does not supersede across a different period", () => {
    const kept = supersede([
      row({ period: "2024-Q3", asOf: "2024-11-01" }),
      row({ period: "2024-Q2", asOf: "2025-02-14" }),
    ]);
    expect(kept).toHaveLength(2);
  });

  test("does not supersede across a different entity", () => {
    const kept = supersede([
      row({ entity: "ACME", asOf: "2024-11-01" }),
      row({ entity: "GLOBEX", asOf: "2025-02-14" }),
    ]);
    expect(kept).toHaveLength(2);
  });

  test("keeps rows that differ by label", () => {
    const kept = supersede([
      row({ label: "Total revenue" }),
      row({ label: "Net income", value: "271000" }),
    ]);
    expect(kept).toHaveLength(2);
  });

  test("keeps the same label from a different table", () => {
    const kept = supersede([row({ tableId: "t1" }), row({ tableId: "t2" })]);
    expect(kept).toHaveLength(2);
  });

  test("is a no-op when nothing was restated", () => {
    const rows = [row({ label: "a" }), row({ label: "b" })];
    expect(supersede(rows)).toHaveLength(2);
  });

  test("does not collide two rows across the label/table boundary", () => {
    // With a naive separator-join these two produce the same key, and the
    // older one silently disappears — a figure vanishing from an answer with
    // no error anywhere. Distinct rows must survive as distinct rows.
    const kept = supersede([
      row({ label: "Revenue", tableId: "a b", asOf: "2024-01-01" }),
      row({ label: "Revenue a", tableId: "b", asOf: "2025-01-01" }),
    ]);
    expect(kept).toHaveLength(2);
  });
});

describe("citation gate", () => {
  test("refuses a figure stated without a citation", () => {
    const result = gate("Revenue was 1,251,000.", 3);
    expect(result.refused).toBe(true);
  });

  test("accepts a figure with a citation", () => {
    const result = gate("Revenue was 1,251,000 [ACME_2024-Q3 p.2].", 3);
    expect(result.refused).toBe(false);
    expect(result.citations).toEqual([
      { docId: "ACME_2024-Q3", page: 2 },
    ]);
  });

  test("does not refuse an answer that states no figure", () => {
    // "I don't know" must pass the gate, or the honest answer gets punished.
    const result = gate("The corpus does not cover that period.", 2);
    expect(result.refused).toBe(false);
  });

  test("the page number inside a citation is not itself a figure", () => {
    // Without stripCitations, "[d p.12]" would look like a stated figure and
    // every uncited prose answer citing page 12+ would refuse itself.
    expect(stripCitations("see [d p.12]")).not.toMatch(/12/);
    expect(gate("No figures here [d p.12].", 1).refused).toBe(false);
  });
});

describe("localEmbedding", () => {
  test("has the dimension the chunks table declares", () => {
    expect(localEmbedding("total revenue")).toHaveLength(EMBEDDING_DIM);
  });

  test("is deterministic", () => {
    expect(localEmbedding("total revenue")).toEqual(
      localEmbedding("total revenue"),
    );
  });

  test("is normalised, so cosine distance behaves", () => {
    const norm = Math.hypot(...localEmbedding("total revenue for the quarter"));
    expect(norm).toBeCloseTo(1, 6);
  });

  test("shared tokens score closer than disjoint ones", () => {
    const dot = (a: number[], b: number[]) =>
      a.reduce((s, v, i) => s + v * b[i]!, 0);
    const base = localEmbedding("total revenue");
    const near = localEmbedding("total revenue growth");
    const far = localEmbedding("zebra xylophone");
    expect(dot(base, near)).toBeGreaterThan(dot(base, far));
  });
});
