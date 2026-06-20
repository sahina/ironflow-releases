import { agent } from "@ironflow/node/agent";
import { EVENTS } from "./events.js";
import { webSearch, summarizeWith, type SearchResult } from "./tools.js";

// ── Research Agent ──────────────────────────────────────────────
//
// A durable AI agent that researches a topic in structured steps:
//
//   Plan → Search (×N) → Summarize → Record to memory
//
// All wrappers compose over step.run, so:
//
//   - Memoized: crash mid-run, resume from the last completed step.
//   - Recorded: every input/output is durably stored for time-travel
//     debugging via `ironflow inspect <run-id>`.
//   - Retried: transient failures (API timeouts, rate limits) replay
//     automatically per-step.
//
// The memory() projection ("agent-memory") tracks every research run
// across the agent's history — survives any node restart.
//
// ────────────────────────────────────────────────────────────────

interface ResearchRequest {
  topic: string;
  depth?: "quick" | "standard" | "deep";
}

export const researchAgent = agent(
  {
    id: "research-agent",
    description:
      "Durable AI research agent. Plans queries, searches the web across parallel durable steps, then summarizes findings via llm(). Resumes from the last completed step on failure.",
    triggers: [{ event: EVENTS.AgentResearch }],
    memory: {
      streamId: "agent-memory",
      projection: "agent-memory",
    },
    recording: true,
  },
  async ({ event, tool, llm, memory, logger }) => {
    const { topic, depth = "standard" } = event.data as ResearchRequest;
    logger.info(`researching ${topic} (depth=${depth})`);

    // Step 1: plan — generate targeted search queries.
    // Plain step.run is fine for pure compute that needs no Zod schema.
    const queries = planQueries(topic, depth);

    // Step 2: search each query as an independent durable step.
    // byArgs idempotency means a replay with the same query reuses
    // the cached result rather than calling the API again.
    const allResults: SearchResult[] = [];
    for (const query of queries) {
      const results = await tool(webSearch, { query });
      allResults.push(...results);
    }

    // Step 3: summarize via llm() — memoizes the assistant response,
    // so a crash here doesn't re-bill the provider.
    const summary = await llm.complete({
      messages: [{ role: "user", content: `Topic: ${topic}\nSources: ${allResults.length}` }],
      call: () => summarizeWith(topic, allResults),
    });

    // Step 4: persist the run into the agent-memory projection so the
    // next research task can reference past topics.
    const summaryText = String(summary.content ?? "(no summary)");
    await memory.append("agent.research.completed", {
      topic,
      depth,
      summary: summaryText,
      sourcesUsed: allResults.length,
      queriesExecuted: queries.length,
      completedAt: new Date().toISOString(),
    });

    return {
      topic,
      depth,
      summary: summaryText,
      sourcesUsed: allResults.length,
      queriesExecuted: queries.length,
    };
  },
);

function planQueries(
  topic: string,
  depth: "quick" | "standard" | "deep",
): string[] {
  const queries = [`${topic} overview`, `${topic} best practices`];
  if (depth === "standard" || depth === "deep") {
    queries.push(`${topic} common pitfalls`);
  }
  if (depth === "deep") {
    queries.push(`${topic} advanced techniques`);
    queries.push(`${topic} case studies`);
  }
  return queries;
}
