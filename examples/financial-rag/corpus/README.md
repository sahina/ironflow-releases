# Corpus

**Generated, not committed.** Run `pnpm seed-corpus` and two synthetic 10-Q
filings appear here.

```
ACME_2024-Q3_2024-11-01.pdf   original
ACME_2024-Q3_2025-02-14.pdf   restated — revenue revised down
```

Filenames encode scope, and the ingest workflow parses them:

```
ENTITY_PERIOD_ASOF.pdf
```

- `ENTITY` — ticker or short company name
- `PERIOD` — the reporting period the filing covers
- `ASOF` — the date the filing was made. **This is the restatement tiebreaker.**
  Two filings with the same entity and period are the same facts restated, and
  the later `ASOF` wins.

## Why synthetic

The eval needs ground truth. Deriving thirty correct answers by reading a real
EDGAR filing is hours of careful work and easy to get subtly wrong — and an
eval scored against slightly-wrong answers is worse than no eval.

Here the figures are authored in `scripts/seed-corpus.ts`, so the golden set is
exactly right. `tests/scoring.test.ts` asserts the two stay in sync, which means
editing a number in one place and not the other fails a test rather than
quietly corrupting the gate.

**The honest cost:** a generated filing is far tidier than a real one. Real
10-Qs have merged cells, footnote markers, multi-line labels, and inconsistent
units. This corpus under-sells how hard table extraction actually is.

## Using real filings

1. Download 10-Qs from [SEC EDGAR](https://www.sec.gov/edgar/search/).
2. Rename them to the `ENTITY_PERIOD_ASOF.pdf` convention above.
3. Delete the generated PDFs so the two do not mix.
4. **Rewrite `evals/golden.yaml` completely.** Every `expectedValue` in it
   refers to the synthetic corpus and will be wrong. The sync test in
   `tests/scoring.test.ts` will fail until you do, which is the point.
