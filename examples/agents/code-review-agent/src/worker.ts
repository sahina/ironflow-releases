import { createWorker } from "@ironflow/node";
import { codeReviewAgent } from "./agent.js";

// ── Worker Entry Point ─────────────────────────────────────────
//
//   pnpm dev          # Watch mode
//   pnpm start        # Production mode
//
// Trigger:
//   pnpm trigger octocat/hello 42
//
// Approve from another terminal:
//   pnpm run approve <runId>
//
// Reject with reason:
//   pnpm run approve <runId> false "looks unsafe"
//
// ────────────────────────────────────────────────────────────────

const worker = createWorker({
  functions: [codeReviewAgent],
});

worker.start().then(() => {
  console.log(`code-review-agent worker ready (pid ${process.pid})`);
});
