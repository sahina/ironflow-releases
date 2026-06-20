import { createWorker, type IronflowProjection } from "@ironflow/node";
import { researchAgent } from "./agent.js";
import { agentMemory } from "./memory.js";

// ── Worker Entry Point ─────────────────────────────────────────
//
// Start the worker to connect to Ironflow and begin processing:
//
//   pnpm dev          # Watch mode (restarts on file changes)
//   pnpm start        # Production mode
//
// Then trigger a research task:
//
//   ironflow emit agent.research --data '{"topic":"event sourcing"}'
//
// Monitor in the dashboard at http://localhost:9123
// Time-travel debug with: ironflow inspect <run-id>
//
// ────────────────────────────────────────────────────────────────

const worker = createWorker({
  functions: [researchAgent],
  projections: [agentMemory as IronflowProjection],
});

worker.start().then(() => {
  console.log("Research agent worker started");
  console.log("Emit a research task:");
  console.log(
    '  ironflow emit agent.research --data \'{"topic":"event sourcing"}\'',
  );
});
