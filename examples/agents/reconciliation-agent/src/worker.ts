import { serverUrl } from "./config.js";
import { createWorker, type IronflowProjection } from "@ironflow/node";
import { reconciliationCaseAgent } from "./agent.js";
import { caseOperations, curatedRules } from "./memory.js";
import { reconcileStatement } from "./statement.js";
import { sweepDeadlines } from "./sweep.js";

// ── Worker Entry Point ─────────────────────────────────────────
//
//   pnpm dev          # Watch mode (restarts on file changes)
//   pnpm start        # Production mode
//
// Trigger a statement:
//
//   pnpm trigger
//
// Approve or reject a case's outbound contact:
//
//   pnpm approve -- <runId> [true|false] [reason]
//
// Signal a counterparty reply:
//
//   pnpm reply -- <caseId> "<reply text>"
//
// ────────────────────────────────────────────────────────────────

const worker = createWorker({
  functions: [reconcileStatement, reconciliationCaseAgent, sweepDeadlines],
  projections: [caseOperations as IronflowProjection, curatedRules as IronflowProjection],
  serverUrl,
});

// worker.start() never resolves — do not await it, and do not hang a .then()
// off it either: that callback is dead code for the same reason. Log first,
// then hand the process over to the poll loop.
console.log(`reconciliation-agent worker ready (pid ${process.pid})`);
worker.start();
