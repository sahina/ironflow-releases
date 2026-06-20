import { createWorker } from "@ironflow/node";
import { codeReviewAgent } from "./agent.js";

// ── Worker Entry Point ─────────────────────────────────────────
//
//   pnpm dev          # Watch mode
//   pnpm start        # Production mode
//
// Trigger:
//   pnpm trigger -- octocat/hello 42
//
// Approve from another terminal:
//   pnpm approve -- <runId>
//
// Reject with reason:
//   pnpm approve -- <runId> false "looks unsafe"
//
// ────────────────────────────────────────────────────────────────

// SDK reads IRONFLOW_SERVER_URL automatically; this preserves the
// IRONFLOW_URL alias used by some demo runners. When both are set,
// IRONFLOW_URL takes precedence (matches @ironflow/node agent runtime).
const serverUrl = process.env.IRONFLOW_URL;

const worker = createWorker({
  functions: [codeReviewAgent],
  ...(serverUrl ? { serverUrl } : {}),
});

worker.start().then(() => {
  console.log(`code-review-agent worker ready (pid ${process.pid})`);
});
