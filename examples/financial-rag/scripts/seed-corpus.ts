/**
 * Writes two synthetic 10-Q filings into corpus/.
 *
 * Synthetic on purpose. The eval needs ground truth, and deriving ~30 correct
 * answers by reading a real EDGAR filing is hours of error-prone work. Here the
 * numbers are authored, so the golden set is exact.
 *
 * The trade-off is real and belongs in the README: a generated filing is far
 * tidier than a real one, so it under-sells how hard table extraction is.
 * corpus/README.md explains how to drop in real EDGAR filings.
 *
 * Two filings, not one: ACME_2024-Q3 appears twice with different as-of dates
 * and a restated revenue figure. That is what exercises the supersession rule
 * (latest as_of wins). One filing cannot demonstrate it, and a broken
 * supersession query would pass every test.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { PDFDocument, StandardFonts } from "pdf-lib";

export interface Filing {
  asOf: string;
  label: string;
  rows: [string, string, string][];
}

/** Authored figures. These are the source of truth for evals/golden.yaml. */
export const FILINGS: Filing[] = [
  {
    asOf: "2024-11-01",
    label: "original",
    rows: [
      ["Total revenue", "1,284,000", "1,102,000"],
      ["Cost of revenue", "512,000", "466,000"],
      ["Gross profit", "772,000", "636,000"],
      ["Operating expenses", "418,000", "395,000"],
      ["Operating income", "354,000", "241,000"],
      ["Net income", "271,000", "183,000"],
    ],
  },
  {
    asOf: "2025-02-14",
    label: "restated",
    // Revenue restated down, and everything downstream of it moves with it.
    // A question about Q3 revenue must return 1,251,000 — the later filing wins.
    rows: [
      ["Total revenue", "1,251,000", "1,102,000"],
      ["Cost of revenue", "512,000", "466,000"],
      ["Gross profit", "739,000", "636,000"],
      ["Operating expenses", "418,000", "395,000"],
      ["Operating income", "321,000", "241,000"],
      ["Net income", "246,000", "183,000"],
    ],
  },
];

const PROSE = [
  "Management's Discussion and Analysis",
  "",
  "Revenue growth this quarter was driven primarily by expansion in the",
  "enterprise segment, which contributed the majority of incremental",
  "bookings. Gross margin remained broadly stable year over year.",
  "",
  "The Company uses ARR (annual recurring revenue) and NRR (net revenue",
  "retention) as supplemental measures. These are non-GAAP figures and are",
  "not a substitute for the GAAP results presented in the following pages.",
  "",
  "Liquidity remains sufficient to fund operations for at least the next",
  "twelve months without additional financing.",
];

export async function buildFiling(filing: Filing): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  // Page 1 — narrative prose. Gives the retriever non-table content to return,
  // so "prose only" results are distinguishable from a broken table pipeline.
  const p1 = doc.addPage([612, 792]);
  p1.drawText("ACME CORPORATION", { x: 60, y: 730, size: 16, font: bold });
  p1.drawText("Form 10-Q - Quarter ended September 30, 2024", {
    x: 60,
    y: 708,
    size: 11,
    font,
  });
  p1.drawText(`Filed: ${filing.asOf}`, { x: 60, y: 690, size: 11, font });
  PROSE.forEach((line, i) =>
    p1.drawText(line, { x: 60, y: 650 - i * 16, size: 10, font }),
  );

  // Page 2 — the financial table, drawn as positioned text in aligned columns,
  // which is what a real filing's extracted text looks like.
  const p2 = doc.addPage([612, 792]);
  p2.drawText("Condensed Consolidated Statements of Operations", {
    x: 60,
    y: 730,
    size: 12,
    font: bold,
  });
  p2.drawText("(in thousands, unaudited)", { x: 60, y: 712, size: 9, font });
  const cols = [60, 330, 450];
  ["", "Q3 2024", "Q3 2023"].forEach((h, c) =>
    p2.drawText(h, { x: cols[c]!, y: 680, size: 10, font: bold }),
  );
  filing.rows.forEach((row, r) =>
    row.forEach((cell, c) =>
      p2.drawText(cell, { x: cols[c]!, y: 656 - r * 20, size: 10, font }),
    ),
  );

  return doc.save();
}

/** Filename encodes scope — parseScope() in the poll workflow depends on it. */
export function filingName(filing: Filing): string {
  return `ACME_2024-Q3_${filing.asOf}.pdf`;
}

async function main() {
  await mkdir("corpus", { recursive: true });
  for (const filing of FILINGS) {
    const name = filingName(filing);
    await writeFile(`corpus/${name}`, await buildFiling(filing));
    console.log(`wrote corpus/${name} (${filing.label})`);
  }
}

// Only run when invoked directly, so tests can import FILINGS as ground truth
// without writing files as a side effect of the import.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
