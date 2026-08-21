import { createClient } from "@ironflow/node";
import { agent } from "@ironflow/node/agent";
import { EVENTS, type IngestBatchClosed } from "../events.js";
import { answerQuestion } from "../src/agent.js";
import { stableId } from "../src/hash.js";
import { searchDocuments, withIndexVersion } from "../src/retriever.js";
import { TOOLS } from "../src/tools.js";
import {
  aggregate,
  loadGolden,
  numericMatch,
  passesGate,
  retrievalMatch,
  type QuestionResult,
} from "../src/scoring.js";

const client = createClient({
  serverUrl: process.env.IRONFLOW_URL ?? "http://localhost:9123",
});

const GOLDEN_PATH = process.env.GOLDEN_PATH ?? "./evals/golden.yaml";

/**
 * W3 — score the shadow index before anyone can query it.
 *
 * An agent() rather than a createFunction() because the agent tier drives the
 * real loop, and agent() is what supplies ctx.llm and ctx.tool with per-turn
 * memoization.
 */
export const runEval = agent(
  {
    id: "run-eval",
    description:
      "Scores a freshly ingested index version against the golden set across three tiers, then emits a pass or regress verdict that gates promotion.",
    triggers: [{ event: EVENTS.IngestBatchClosed }],
    mode: "pull",
    // Load-bearing: withIndexVersion below is module-level state, so two
    // overlapping evals would score each other's index.
    concurrency: { limit: 1 },
    tools: TOOLS,
    maxTurns: 200,
  },
  async (ctx) => {
    const batch = ctx.event.data as IngestBatchClosed;

    const golden = await ctx.step.run("load-golden", async () =>
      loadGolden(GOLDEN_PATH),
    );

    // Point retrieval at the CANDIDATE index for the rest of this run. The
    // agent's tools are module constants and cannot take the version as an
    // argument, so this is how the agent tier scores the shadow index instead
    // of the corpus that is already live.
    withIndexVersion(batch.indexVersion);
    try {

    const results: QuestionResult[] = [];

    for (const row of golden) {
      // Tier 1 — retrieval. No model call, so a retrieval regression is cheap
      // to detect and tells you chunking or embedding broke.
      const retrievalPassed = await ctx.step.run(
        `retrieval-${row.id}`,
        async () => {
          if (!row.expectedDoc) return true;
          // batch.indexVersion, NOT the live pointer. searchDocuments
          // defaults to the pointer, which would score the corpus that is
          // already live and approve a candidate nobody looked at.
          const hits = await searchDocuments({
            query: row.question,
            limit: 8,
            indexVersion: batch.indexVersion,
          });
          return retrievalMatch(
            hits.map((h) => h.docId),
            row.expectedDoc,
          );
        },
      );

      // Tiers 2 and 3 share one agent run: the answer is scored for the exact
      // figure AND for whether the loop behaved. Running the agent twice would
      // double the cost to learn the same thing.
      const answer = await answerQuestion(ctx, row.question);

      const numericPassed = row.expectedValue
        ? numericMatch(answer.answer, row.expectedValue)
        : (row.expectedContains ?? []).every((s) =>
            answer.answer.toLowerCase().includes(s.toLowerCase()),
          );

      // The judged tier is behavioural, not semantic: did the loop produce a
      // citation when it stated a figure, and did it avoid refusing?
      const judged = answer.refused ? 0 : answer.citations.length > 0 ? 1 : 0.5;

      results.push({ id: row.id, retrievalPassed, numericPassed, judged });
      ctx.logger.info("scored", {
        id: row.id,
        retrievalPassed,
        numericPassed,
        judged,
      });
    }

    const scores = aggregate(results);
    const passed = passesGate(scores);

    await ctx.step.run("emit-verdict", async () => {
      // Derived, not random: this step can retry, and a random key would insert
      // a second verdict row for the same eval.
      const runKey = stableId("eval", batch.batchId, batch.indexVersion);
      await client.emit(
        passed ? EVENTS.EvalPassed : EVENTS.EvalRegressed,
        {
          runKey,
          indexVersion: batch.indexVersion,
          batchId: batch.batchId,
          numericPassed: scores.numericPassed,
          numericTotal: scores.numericTotal,
          retrievalPassed: scores.retrievalPassed,
          retrievalTotal: scores.retrievalTotal,
          judgedMean: String(scores.judgedMean.toFixed(3)),
          failingCsv: scores.failing.join(","),
        },
        { idempotencyKey: runKey },
      );
    });

    ctx.logger.info("eval complete", {
      indexVersion: batch.indexVersion,
      passed,
      ...scores,
    });
    return { passed, ...scores };
    } finally {
      // Always release, or a later CLI query in the same process would keep
      // reading the shadow index.
      withIndexVersion(undefined);
    }
  },
);
