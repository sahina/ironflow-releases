/**
 * Ask a question from the terminal:  pnpm ask "what was ACME's Q3 revenue?"
 *
 * Runs the tools directly rather than through a workflow. The agent loop
 * itself needs an Ironflow run context (ctx.llm, ctx.tool), so this is the
 * thin path: retrieve, then answer with one model call and the same citation
 * gate the eval scores against.
 */
import Anthropic from "@anthropic-ai/sdk";
import { closePool } from "./src/db.js";
import { isOfflineEmbedding } from "./src/embed.js";
import { gate } from "./src/agent.js";
import { listSources, queryTable, searchDocuments } from "./src/retriever.js";

const anthropic = new Anthropic();

const SYSTEM = `You answer questions about financial filings using ONLY the
retrieved context below.

- Every sentence containing a figure must end with a citation of the form
  [docId p.N].
- If the context does not contain the answer, say so plainly and name what IS
  covered. Never invent a figure.
- Where the same line item appears twice, the row with the later as-of date is
  the restated, correct one.`;

async function main() {
  const question = process.argv.slice(2).join(" ").trim();
  if (!question) {
    console.error('usage: pnpm ask "your question"');
    process.exit(1);
  }

  if (isOfflineEmbedding()) {
    console.warn("(offline embeddings — retrieval quality is meaningless)\n");
  }

  const [hits, rows, sources] = await Promise.all([
    searchDocuments({ query: question, limit: 8 }),
    queryTable({ limit: 200 }),
    listSources(),
  ]);

  if (sources.length === 0) {
    console.error(
      "The corpus is empty. Run `pnpm seed-corpus`, start the worker, and let a batch finish.",
    );
    await closePool();
    process.exit(1);
  }

  const context = [
    "## Filings available",
    ...sources.map((s) => `- ${s.docId} (${s.entity} ${s.period}, as of ${s.asOf})`),
    "",
    "## Retrieved passages",
    ...hits.map((h) => `[${h.docId} p.${h.page}] (${h.kind}) ${h.text}`),
    "",
    "## Extracted table figures",
    ...rows.map(
      (r) => `[${r.docId} p.${r.page}] ${r.label}: ${r.value} ${r.unit} (as of ${r.asOf})`,
    ),
  ].join("\n");

  const message = await anthropic.messages.create({
    model: "claude-opus-5",
    max_tokens: 2000,
    system: SYSTEM,
    messages: [{ role: "user", content: `${context}\n\n## Question\n${question}` }],
  });

  const text = message.content
    .filter((c): c is Anthropic.TextBlock => c.type === "text")
    .map((c) => c.text)
    .join("\n");

  const result = gate(text, 1);

  console.log(`\n${result.answer}\n`);
  if (result.refused) {
    console.warn(
      "REFUSED: the answer states a figure with no citation. That is a bug in the\n" +
        "answer, not in your question — an uncited number cannot be checked.",
    );
  }
  await closePool();
}

main().catch(async (err) => {
  console.error(err);
  await closePool();
  process.exit(1);
});
