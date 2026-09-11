import { serverUrl } from "../src/config.js";
import { createClient } from "@ironflow/node";
import { EVENTS } from "../src/events.js";

const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
const [runId, approvedArg, reason] = args;
if (!runId || (approvedArg !== undefined && approvedArg !== "true" && approvedArg !== "false")) {
  console.error("usage: pnpm approve -- <runId> [true|false] [reason]");
  process.exit(1);
}

const client = createClient({ serverUrl });
await client.emit(EVENTS.ApproveContact, {
  runId,
  approved: approvedArg !== "false",
  approver: "operator",
  ...(reason ? { reason } : {}),
});
console.log(`approval sent for ${runId}`);
