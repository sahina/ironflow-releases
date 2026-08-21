/**
 * Fire the ingest poll now instead of waiting for the 15-minute cron tick.
 *
 * `poll-source` is triggered by EVENTS.PollTick, which the scheduler emits on
 * a schedule. Emitting it by hand runs exactly the same workflow — there is no
 * separate manual path to drift from the scheduled one.
 */
import { createClient } from "@ironflow/node";
import { EVENTS } from "../events.js";

const client = createClient({
  serverUrl: process.env.IRONFLOW_URL ?? "http://localhost:9123",
});

await client.emit(EVENTS.PollTick, { source: "manual" });
console.log("poll triggered — watch the worker log for the batch");
