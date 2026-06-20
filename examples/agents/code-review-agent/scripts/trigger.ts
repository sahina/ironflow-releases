// Trigger a pr.opened event so the worker picks up a review.
//
//   pnpm trigger -- <repo> <prNumber>

import { IronflowClient } from "@ironflow/node";
import { EVENTS } from "../src/events.js";

const [, , repoArg, prArg] = process.argv;
const repo = repoArg ?? "octocat/hello";
const pr = Number(prArg ?? 42);

if (!Number.isInteger(pr) || pr <= 0) {
  console.error("usage: trigger <repo> <prNumber>");
  process.exit(2);
}

const client = new IronflowClient({
  serverUrl: process.env.IRONFLOW_URL ?? "http://localhost:9123",
  apiKey: process.env.IRONFLOW_API_KEY,
});

const result = await client.emit(EVENTS.PrOpened, { repo, pr });
console.log(`emitted ${EVENTS.PrOpened} eventId=${result.eventId} runIds=${result.runIds.join(",")}`);
console.log(`runId: ${result.runIds[0]}`);
console.log("approve with: pnpm approve -- " + result.runIds[0]);
