// Send the human-approval event so the agent's approve("post-review")
// gate releases.
//
//   pnpm approve -- <runId>                   # approve
//   pnpm approve -- <runId> false "reason"    # reject with reason

import { IronflowClient } from "@ironflow/node";

const [, , runIdArg, approvedArg, reasonArg] = process.argv;

if (!runIdArg) {
  console.error("usage: approve <runId> [approved] [reason]");
  process.exit(2);
}

const approved = approvedArg === undefined ? true : approvedArg === "true";

const client = new IronflowClient({
  serverUrl: process.env.IRONFLOW_URL ?? "http://localhost:9123",
  apiKey: process.env.IRONFLOW_API_KEY,
});

const eventName = "agent.approve.post-review";
await client.emit(eventName, {
  runId: runIdArg,
  approved,
  approver: process.env.USER ?? "cli",
  reason: reasonArg,
});

console.log(`emitted ${eventName} runId=${runIdArg} approved=${approved}${reasonArg ? ` reason="${reasonArg}"` : ""}`);
