/**
 * The worker. Runs all four workflows and the external vector projection.
 *
 * Pull mode (createWorker), not serve(). This is load-bearing, not a
 * preference — see README, "Why pull mode".
 */
import { createWorker } from "@ironflow/node";
import { vectorIndex } from "./projections/vector-index.js";
import { parseDocument } from "./workflows/parse-document.js";
import { pollSource } from "./workflows/poll-source.js";
import { runEval } from "./workflows/run-eval.js";
import {
  promoteIndex,
  recordRegression,
} from "./workflows/promote-index.js";
import { isOfflineEmbedding } from "./src/embed.js";

if (isOfflineEmbedding()) {
  console.warn(
    "VOYAGE_API_KEY is not set — using the offline stand-in embedding.\n" +
      "The pipeline will run end to end, but retrieval quality is meaningless.\n" +
      "Set a real key before drawing conclusions from eval scores.\n",
  );
}

const worker = createWorker({
  functions: [
    pollSource,
    parseDocument,
    runEval,
    promoteIndex,
    recordRegression,
  ],
  projections: [vectorIndex],
  serverUrl: process.env.IRONFLOW_URL ?? "http://localhost:9123",
});

// Deliberately not awaited: worker.start() never resolves, and any setup
// written after an await here would be dead code.
worker.start();
console.log("financial-rag worker running");
