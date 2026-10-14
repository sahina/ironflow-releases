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
//   pnpm trigger doc-1 https://example.com/invoice.png
//
// Or directly via the CLI:
//
//   ironflow emit doc.received \
//     --data '{"docId":"doc-1","imageUrl":"https://example.com/invoice.png"}'
//
// Verify state:
//
//   pnpm verify doc-1
//
// ────────────────────────────────────────────────────────────────

const worker = createWorker({
  functions: [docProcessor],
  projections: [docMemory as IronflowProjection],
});

worker.start().then(() => {
  console.log(`doc-processor worker ready (pid ${process.pid})`);
});
