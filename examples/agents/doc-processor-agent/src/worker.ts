import { createWorker, type IronflowProjection } from "@ironflow/node";
import { docProcessor } from "./agent.js";
import { docMemory } from "./memory.js";

// ── Worker Entry Point ─────────────────────────────────────────
//
// Connect to Ironflow and process doc.received events.
//
//   pnpm dev          # Watch mode (restarts on file changes)
//   pnpm start        # Production mode
//
// Trigger a doc:
//
//   pnpm trigger -- doc-1 https://example.com/invoice.png
//
// Or directly via the CLI:
//
//   ironflow emit doc.received \
//     --data '{"docId":"doc-1","imageUrl":"https://example.com/invoice.png"}'
//
// Verify state:
//
//   pnpm verify -- doc-1
//
// ────────────────────────────────────────────────────────────────

// SDK reads IRONFLOW_SERVER_URL automatically; this preserves the
// IRONFLOW_URL alias used by some demo runners. When both are set,
// IRONFLOW_URL takes precedence (matches @ironflow/node agent runtime).
const serverUrl = process.env.IRONFLOW_URL;

const worker = createWorker({
  functions: [docProcessor],
  projections: [docMemory as IronflowProjection],
  ...(serverUrl ? { serverUrl } : {}),
});

worker.start().then(() => {
  console.log(`doc-processor worker ready (pid ${process.pid})`);
});
