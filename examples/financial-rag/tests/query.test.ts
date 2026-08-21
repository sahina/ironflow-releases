import { describe, expect, test } from "vitest";
import {
  buildHybridQuery,
  escapeLikePattern,
  escapeLiteral,
} from "../src/query.js";

const base = {
  vectorLiteral: "[0.1,0.2]",
  keywords: "revenue",
  indexVersion: 3,
  limit: 10,
};

describe("buildHybridQuery", () => {
  test("always pins to a single index version", () => {
    const { sql, params } = buildHybridQuery(base);
    expect(sql).toContain("index_version = $");
    expect(params).toContain(3);
  });

  test("uses both vector distance and text rank", () => {
    const { sql } = buildHybridQuery(base);
    expect(sql).toContain("<=>"); // pgvector cosine distance
    expect(sql).toContain("ts_rank"); // keyword relevance
  });

  test("keeps only the newest as_of per entity+period", () => {
    const { sql } = buildHybridQuery(base);
    expect(sql).toContain("PARTITION BY entity, period");
    expect(sql).toContain("ORDER BY as_of DESC");
  });

  test("keeps EVERY chunk of the newest filing, not one row per partition", () => {
    // The bug this pins: ROW_NUMBER() numbers rows 1,2,3... inside the
    // partition, so `WHERE recency = 1` keeps exactly ONE chunk per
    // (entity, period) and silently discards the rest of the filing.
    // RANK() gives every row sharing the max as_of the same rank 1.
    //
    // Asserting on the string is weak, but the alternative is a live Postgres.
    // The previous version of this test only checked that "PARTITION BY" was
    // present, which is true of both the correct and the broken query.
    const { sql } = buildHybridQuery(base);
    expect(sql).toContain("RANK() OVER");
    expect(sql).not.toMatch(/ROW_NUMBER\(\)\s+OVER/);
  });

  test("binds optional filters instead of interpolating them", () => {
    const { sql, params } = buildHybridQuery({
      ...base,
      entity: "ACME'; DROP TABLE chunks; --",
    });
    expect(sql).not.toContain("DROP TABLE");
    expect(params).toContain("ACME'; DROP TABLE chunks; --");
  });

  test("omits the entity filter when not supplied", () => {
    const { sql } = buildHybridQuery(base);
    expect(sql).not.toContain("AND entity =");
  });

  test("numbers every placeholder distinctly", () => {
    // An off-by-one in the p() counter would silently bind the wrong value to
    // the wrong slot, which reads as bad retrieval rather than as a bug.
    const { sql, params } = buildHybridQuery({
      ...base,
      entity: "ACME",
      period: "2024-Q3",
    });
    const placeholders = [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
    expect(new Set(placeholders).size).toBe(params.length);
    expect(Math.max(...placeholders)).toBe(params.length);
  });
});

describe("escapeLikePattern", () => {
  test("neutralises a percent so it matches literally", () => {
    // "Gross margin %" is a routine financial row label. Unescaped, the % is a
    // LIKE wildcard and the clause matches unrelated rows, returning a
    // plausible wrong figure with no error anywhere.
    expect(escapeLikePattern("Gross margin %")).toBe("Gross margin \\%");
  });

  test("neutralises an underscore — LIKE's single-character wildcard", () => {
    expect(escapeLikePattern("net_income")).toBe("net\\_income");
  });

  test("escapes the backslash first so the escape char is not itself a wildcard", () => {
    expect(escapeLikePattern("a\\b")).toBe("a\\\\b");
  });

  test("leaves an ordinary label alone", () => {
    expect(escapeLikePattern("Total revenue")).toBe("Total revenue");
  });
});

describe("escapeLiteral", () => {
  test("doubles a single quote — an apostrophe in a row label is routine", () => {
    expect(escapeLiteral("O'Brien")).toBe("O''Brien");
  });

  test("neutralises a quote-break injection attempt", () => {
    // Composed into `label LIKE '%<value>%'`, the escaped form keeps the
    // closing quote inside the literal instead of ending it early.
    expect(escapeLiteral("a' OR '1'='1")).toBe("a'' OR ''1''=''1");
  });

  test("leaves a backslash alone — Postgres literals are not C strings", () => {
    expect(escapeLiteral("path\\to")).toBe("path\\to");
  });

  test("is a no-op on ordinary labels", () => {
    expect(escapeLiteral("Total revenue")).toBe("Total revenue");
  });
});
