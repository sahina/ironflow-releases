import { serverUrl } from "../src/config.js";
import { createClient } from "@ironflow/node";
import { redactReply } from "../src/redact.js";
import { ACTION_FOR_CAUSE, CAUSES } from "../src/causes.js";
import { EVENTS } from "../src/events.js";

const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
const [caseId, body] = args;
if (!caseId || !body) {
  console.error('usage: pnpm reply -- <caseId> "<reply text>"');
  process.exit(1);
}

// The body is classified before anything sees it; the model never reads
// the prose (src/redact.ts). A classification with no matching cause (an
// unparseable reply, "unclear") sends no confirmedActionId — the agent's
// own confirmedActionFor treats that as "did not confirm anything", never
// as a stand-in for the model's proposal.
const { classification } = redactReply(body);
const cause = CAUSES.find((c) => c.startsWith(classification.split("-")[0]!));

const client = createClient({ serverUrl });
await client.emit(EVENTS.CaseResolutionSignal, {
  caseId,
  kind: "reply",
  replyClassification: classification,
  ...(cause ? { confirmedActionId: ACTION_FOR_CAUSE[cause] } : {}),
});
console.log(`reply signalled for ${caseId} (classified ${classification})`);
