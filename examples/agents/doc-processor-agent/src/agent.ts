import { agent } from "@ironflow/node/agent";
import { z } from "zod";
import { EVENTS } from "./events.js";
import { ocr, classify, publish } from "./tools.js";

const DocReceivedSchema = z.object({
  docId: z.string(),
  imageUrl: z.string().url(),
});

// ── Doc Processor Agent ────────────────────────────────────────
//
// Three-step pipeline: OCR → classify → publish.
//
// Every tool() call is a memoized step. memory.append() writes a
// `doc.processed` event to the agent's entity stream and waits for
// the doc-processor-memory projection to catch up before returning,
// so subsequent reads in the same run see the write.
//
// Crash-resume narrative:
//   1. Worker dies during OCR (the slow step).
//   2. The run is left in `running` with no `tool.ocr` step row.
//   3. A fresh worker pulls the orphaned run.
//   4. OCR re-executes (no cached row); classify + publish run fresh;
//      memory.append + memory.append.wait run fresh.
//
// If the crash had landed between OCR and classify, OCR would
// replay from its cached row and only classify/publish/memory would
// re-execute.
//
// See docs/tutorials/agent-survives-crash.md for the full walkthrough.
//
// ────────────────────────────────────────────────────────────────

export const docProcessor = agent(
  {
    id: "doc-processor",
    description: "Durable OCR → classify → publish pipeline. Resumes from cached step on crash.",
    triggers: [{ event: EVENTS.DocReceived }],
    schema: DocReceivedSchema,
    tools: [ocr, classify, publish],
    memory: {
      streamId: "agent-memory",
      projection: "doc-processor-memory",
    },
    recording: true,
  },
  async ({ event, tool, memory, logger }) => {
    const { docId, imageUrl } = event.data;
    logger.info(`processing ${docId}`);

    const { text } = await tool(ocr, { imageUrl });
    const { category } = await tool(classify, { text });
    await tool(publish, { docId, category });

    await memory.append(EVENTS.DocProcessed, {
      docId,
      status: "published",
      category,
      processedAt: new Date().toISOString(),
    });

    return { docId, category };
  },
);
