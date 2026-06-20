// Trigger a doc.received event so the worker has something to chew on.
//
//   pnpm trigger -- <docId> <imageUrl>
//
// Defaults: docId="doc-1", imageUrl="https://example.com/invoice.png"

import { IronflowClient } from "@ironflow/node";
import { EVENTS } from "../src/events.js";

const [, , docIdArg, imageUrlArg] = process.argv;
const docId = docIdArg ?? "doc-1";
const imageUrl = imageUrlArg ?? "https://example.com/invoice.png";

const client = new IronflowClient({
  serverUrl: process.env.IRONFLOW_URL ?? "http://localhost:9123",
  apiKey: process.env.IRONFLOW_API_KEY,
});

const result = await client.emit(EVENTS.DocReceived, { docId, imageUrl });
console.log(`emitted ${EVENTS.DocReceived} eventId=${result.eventId} docId=${docId}`);
