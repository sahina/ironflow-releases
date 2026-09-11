// Live regression check, run by the crash demo against its isolated server.
import { serverUrl } from "../src/config.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createClient } from "@ironflow/node";
import { EVENTS } from "../src/events.js";

const client = createClient({ serverUrl });
const statement = JSON.parse(readFileSync(new URL("../fixtures/statement.json", import.meta.url), "utf8"));
// Distinct statement events, arriving together. Case deduplication must happen
// server-side; neither parent can rely on the other's projection being current.
const statements = await Promise.all([
  client.emit(EVENTS.StatementReceived, statement),
  client.emit(EVENTS.StatementReceived, statement),
]);
const runIds = statements.flatMap((result) => result.runIds);
assert.equal(runIds.length, 2);
const deadline = Date.now() + 90_000;
let complete = false;
while (Date.now() < deadline) {
  const runs = await Promise.all(runIds.map((id) => client.getRun(id)));
  for (const run of runs) assert.notEqual(run.status, "failed", JSON.stringify(run.error));
  if (runs.every((run) => run.status === "completed")) {
    complete = true;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}
assert.ok(complete, "Both statements must finish before checking case count");
const { runs, nextCursor } = await client.listRuns({ functionId: "reconciliation-case", limit: 100 });
assert.ok(!nextCursor, "Unexpected extra page of case runs");
assert.equal(runs.length, 5, "Two statements must share the same five case runs");
console.log("case reuse verified: two concurrent statements, five case runs");
