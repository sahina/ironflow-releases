import { describe, expect, test } from "vitest";
import { PDFDocument } from "pdf-lib";
import { planRanges, splitPdf } from "../src/pdf.js";

describe("planRanges", () => {
  test("splits evenly when the count divides", () => {
    expect(planRanges(20, 10)).toEqual([
      { index: 0, start: 1, end: 10 },
      { index: 1, start: 11, end: 20 },
    ]);
  });

  test("last range is short when it does not divide", () => {
    expect(planRanges(25, 10)).toEqual([
      { index: 0, start: 1, end: 10 },
      { index: 1, start: 11, end: 20 },
      { index: 2, start: 21, end: 25 },
    ]);
  });

  test("a document smaller than one range is a single range", () => {
    expect(planRanges(3, 10)).toEqual([{ index: 0, start: 1, end: 3 }]);
  });

  test("an empty document produces no ranges", () => {
    expect(planRanges(0, 10)).toEqual([]);
  });
});

describe("splitPdf", () => {
  test("produces one real PDF per range with the right page counts", async () => {
    const src = await PDFDocument.create();
    for (let i = 0; i < 25; i++) src.addPage();
    const bytes = await src.save();

    const parts = await splitPdf(bytes, planRanges(25, 10));
    expect(parts).toHaveLength(3);

    const counts = await Promise.all(
      parts.map(async (p) => (await PDFDocument.load(p)).getPageCount()),
    );
    expect(counts).toEqual([10, 10, 5]);
  });
});
