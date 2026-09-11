import { serverUrl } from "../src/config.js";
import { createClient } from "@ironflow/node";

// Polls ONE run's steps until its send-contact tool step completes, then
// prints that step's output (the `{ deduped }` the provider returned) to
// stdout as JSON. demo-crash-resume.sh uses this after restarting the
// worker: crash recovery goes through the scheduler's stale-claim reclaim
// sweep, not an instant redispatch. cmd/ironflow/serve.go's --dev comment
// says "~50s" (45s threshold + 5s sweep tick), but measured end-to-end
// reclaim latency against a real kill -9 in this demo ran ~130s — the
// default below has margin over the observed number, not the commented
// one. A short fixed sleep proves nothing (worker #2 never even polls the
// job in time); this polls until the specific approved run's own send
// step actually re-executes and completes, or times out.
//
// usage: pnpm exec tsx scripts/wait-for-send.ts <runId>

const [runId] = process.argv.slice(2);
if (!runId) {
  console.error("usage: wait-for-send.ts <runId>");
  process.exit(2);
}

const client = createClient({ serverUrl });
const timeoutMs = Number(process.env.WAIT_SEND_TIMEOUT_MS ?? 180000);
const pollMs = 500;
const deadline = Date.now() + timeoutMs;

while (Date.now() < deadline) {
  const { steps } = await client.getRunSteps(runId);
  const sendStep = steps.find((s) => s.stepId.includes(":tool.send-contact:"));
  if (sendStep?.status === "completed") {
    console.log(JSON.stringify(sendStep.output ?? {}));
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, pollMs));
}

console.error(`timed out after ${timeoutMs}ms waiting for run ${runId} to complete its send step`);
process.exit(1);
