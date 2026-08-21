import { readFile } from "node:fs/promises";
import { createClient, createFunction } from "@ironflow/node";
import { EVENTS, type DocumentVersionCreated } from "../events.js";
import { stableId } from "../src/hash.js";
import { planRanges, splitPdf } from "../src/pdf.js";
import { extractRange } from "../src/extract.js";

const client = createClient({
  serverUrl: process.env.IRONFLOW_URL ?? "http://localhost:9123",
});

const PAGES_PER_RANGE = 10;

/**
 * W2 — one run per filing version.
 *
 * mode "pull" because a 200-page filing takes minutes and a push endpoint
 * would time out. Pull mode is also load-bearing for correctness elsewhere in
 * this example — see the note in README on why not to port this to serve().
 *
 * The parse steps are the expensive part and each is memoized independently:
 * range 4 failing costs range 4, not the whole document.
 *
 * audit-ignore: missing-recording — the one function in this example that must
 * NOT record. Its fetch-pdf step returns a whole filing as base64, and the audit
 * recorder embeds step output inline with no blob overflow on that path, so
 * recording here duplicates every PDF into the audit stream and puts complete
 * financial documents under audit retention. Debug this one from step output and
 * logs instead.
 */
export const parseDocument = createFunction(
  {
    id: "parse-document",
    description:
      "Splits a filing into page ranges, extracts prose sections and financial tables from each with Claude, and emits one event per artifact.",
    triggers: [{ event: EVENTS.DocumentVersionCreated }],
    mode: "pull",
    retry: { maxAttempts: 3 },
  },
  async ({ event, step, logger }) => {
    const doc = event.data as DocumentVersionCreated;
    const scope = {
      entity: doc.entity,
      period: doc.period,
      asOf: doc.asOf,
      indexVersion: doc.indexVersion,
    };

    const pdfBase64 = await step.run("fetch-pdf", async () => {
      const bytes = await readFile(doc.sourceKey);
      return bytes.toString("base64");
    });
    const pdf = Buffer.from(pdfBase64, "base64");

    const ranges = await step.run("plan-ranges", async () => {
      const { PDFDocument } = await import("pdf-lib");
      const pageCount = (await PDFDocument.load(pdf)).getPageCount();
      return planRanges(pageCount, PAGES_PER_RANGE);
    });

    const extractions = await step.map(
      "parse-range",
      ranges,
      // `rangeStep` is load-bearing: without it the map records no step, so a
      // retry re-splits the PDF and re-extracts every range (#1671).
      async (range, rangeStep) =>
        rangeStep.run(`extract:${range.start}-${range.end}`, async () => {
          const [part] = await splitPdf(pdf, [range]);
          return extractRange(part!, {
            docId: doc.docId,
            startPage: range.start,
          });
        }),
      { concurrency: 4 },
    );

    // Every ID here is DERIVED, never random, and doubles as the emit's
    // idempotencyKey. This step emits hundreds of events as one memoized unit:
    // if emit 400 of 600 fails, the step retries and emits 1-399 fire again.
    // With randomUUID() those repeats become duplicate rows and the eval reads
    // a corpus with doubled figures. With derived IDs a retry is a no-op.
    const counts = await step.run("emit-artifacts", async () => {
      let chunks = 0;
      let rows = 0;
      let tables = 0;

      for (const extraction of extractions) {
        for (const section of extraction.sections) {
          const chunkId = stableId(
            doc.docId,
            "chunk",
            section.section,
            section.page,
          );
          await client.emit(
            EVENTS.ChunkExtracted,
            {
              ...scope,
              chunkId,
              docId: doc.docId,
              section: section.section,
              page: section.page,
              text: section.text,
            },
            { idempotencyKey: chunkId },
          );
          chunks++;
        }

        for (const table of extraction.tables) {
          const summaryKey = stableId(doc.docId, "summary", table.tableId);
          await client.emit(
            EVENTS.TableSummaryWritten,
            {
              ...scope,
              tableId: table.tableId,
              docId: doc.docId,
              section: table.section,
              page: table.page,
              summary: table.summary,
            },
            { idempotencyKey: summaryKey },
          );
          tables++;

          for (const row of table.rows) {
            const rowId = stableId(
              doc.docId,
              table.tableId,
              table.page,
              row.label,
            );
            await client.emit(
              EVENTS.TableRowExtracted,
              {
                ...scope,
                rowId,
                docId: doc.docId,
                tableId: table.tableId,
                page: table.page,
                label: row.label,
                value: row.value,
                unit: row.unit,
              },
              { idempotencyKey: rowId },
            );
            rows++;
          }
        }
      }

      return { chunks, rows, tables };
    });

    await step.run("report-parsed", async () => {
      await client.emit(
        EVENTS.DocumentParsed,
        { batchId: doc.batchId, docId: doc.docId, ...counts },
        { idempotencyKey: stableId("parsed", doc.batchId, doc.docId) },
      );
    });

    logger.info("parsed filing", { docId: doc.docId, ...counts });
    return counts;
  },
);
