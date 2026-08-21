/**
 * Two commands:
 *   pnpm ingest          — emit the event that triggers the ingest workflow
 *   pnpm ask "question"  — retrieve from rag.db and answer with one model call
 *
 * `ask` deliberately bypasses Ironflow: retrieval + answer is a synchronous
 * request/response, and there is no ergonomic "emit an event, get the run's
 * result back" client path today. Logged as a gap — same shape financial-rag
 * chose for the same reason.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@ironflow/node";
import { EVENTS } from "./events.js";
import { embed, isOfflineEmbedding } from "./src/embed.js";
import { openDb, searchChunks } from "./src/db.js";

const SYSTEM = `You answer questions about the Forge documentation using ONLY
the retrieved context below.
- Cite every claim with the form [docId#heading].
- If the context does not contain the answer, say so plainly. Never invent.`;

async function ingest() {
  const client = createClient({
    serverUrl: process.env.IRONFLOW_URL ?? "http://localhost:9123",
    apiKey: process.env.IRONFLOW_API_KEY,
  });
  await client.emit(EVENTS.IngestRequested, {
    requestedAt: new Date().toISOString(),
  });
  console.log("ingest requested — watch the worker logs, or `ironflow inspect` the run");
}

async function ask(question: string) {
  if (isOfflineEmbedding()) {
    console.warn("(offline embeddings — retrieval quality is meaningless)\n");
  }
  const db = openDb();
  const [queryVector] = await embed([question], "query");
  const hits = searchChunks(db, queryVector!, 8);
  db.close();

  if (hits.length === 0) {
    console.error("The index is empty. Run `pnpm ingest` with the worker running first.");
    process.exit(1);
  }

  const context = hits
    .map((h) => `[${h.docId}#${h.heading}] ${h.text}`)
    .join("\n\n");

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("No ANTHROPIC_API_KEY — showing retrieved context instead of an answer:\n");
    console.log(context);
    return;
  }

  const anthropic = new Anthropic();
  const message = await anthropic.messages.create({
    model: "claude-opus-5",
    max_tokens: 1500,
    system: SYSTEM,
    messages: [{ role: "user", content: `${context}\n\n## Question\n${question}` }],
  });

  if (message.stop_reason === "refusal") {
    console.error("The model declined this request (stop_reason: refusal).");
    process.exit(1);
  }
  const text = message.content
    .filter((c): c is Anthropic.TextBlock => c.type === "text")
    .map((c) => c.text)
    .join("\n");
  console.log(`\n${text}\n`);
}

const [command, ...rest] = process.argv.slice(2);
if (command === "ingest") {
  ingest().catch((err) => { console.error(err); process.exit(1); });
} else if (command === "ask" && rest.length > 0) {
  ask(rest.join(" ").trim()).catch((err) => { console.error(err); process.exit(1); });
} else {
  console.error('usage: pnpm ingest | pnpm ask "your question"');
  process.exit(1);
}
