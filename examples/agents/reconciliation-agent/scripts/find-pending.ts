import { serverUrl } from "../src/config.js";
import { createClient } from "@ironflow/node";

// Prints the run id of the first reconciliation-case run parked on the
// contact-approval gate. Used by demo-crash-resume.sh to find something to
// approve. Stdout carries ONLY the run id — the shell script captures it
// with $(...) — everything else goes to stderr.

const client = createClient({ serverUrl });

// A run parked on step.waitForEvent (which approve() wraps) has RUN status
// "paused" — "waiting" is the STEP status of that parked step, checked
// below. (internal/engine/yield_orchestrator.go: HandleWaitEventYield sets
// run.Status = store.RunStatusPaused.)
const { runs } = await client.listRuns({ functionId: "reconciliation-case", status: "paused", limit: 50 });

for (const run of runs) {
  const { steps } = await client.getRunSteps(run.id);
  // The stored step id is `${runId}:approve.contact:${index}` (SDK
  // generateStepId, internal/context.ts), not the bare "approve.contact"
  // passed to approve() — match on the segment, not full equality.
  if (steps.some((s) => s.stepId.includes(":approve.contact:") && s.status === "waiting")) {
    console.log(run.id);
    process.exit(0);
  }
}

console.error("no run currently waiting on approve.contact");
process.exit(1);
