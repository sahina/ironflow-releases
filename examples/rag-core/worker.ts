import { createWorker } from "@ironflow/node";
import { ingestCorpus } from "./workflows/ingest-corpus.js";
import { vectorIndex } from "./projections/vector-index.js";
import { isOfflineEmbedding } from "./src/embed.js";

if (isOfflineEmbedding()) {
  console.warn(
    "VOYAGE_API_KEY is not set — using the offline stand-in embedding.\n" +
      "The pipeline runs end to end, but retrieval quality is meaningless.\n",
  );
}

const worker = createWorker({
  functions: [ingestCorpus],
  projections: [vectorIndex],
  serverUrl: process.env.IRONFLOW_URL ?? "http://localhost:9123",
});

// Deliberately not awaited: worker.start() never resolves.
worker.start();
console.log("rag-core worker running");
