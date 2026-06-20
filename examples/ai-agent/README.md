# AI Research Agent — Ironflow Example

A durable AI research agent built with Ironflow. Demonstrates how event-driven architecture with durable execution makes AI agents reliable, observable, and debuggable.

## Why Ironflow for AI Agents?

AI agents make sequential tool calls — search, read, analyze, summarize. Each call depends on the previous result. Traditional frameworks have three problems:

1. **Fragility**: If any tool call fails, the entire agent run is lost
2. **Opacity**: When agents produce wrong results, debugging means grepping logs
3. **Waste**: Retrying a failed agent re-executes all previous steps, burning API credits

Ironflow solves all three:

- **Durable steps**: Each tool call is memoized. If the agent crashes, it resumes from the last completed step — not the beginning
- **Time-travel debugging**: Every step's input and output is permanently recorded. Scrub through any agent run frame-by-frame
- **Event-sourced memory**: Agent activities are recorded as events. Projections derive searchable history automatically

## Architecture

```text
                    ┌────────────────────────────────────────────┐
                    │              Ironflow Server               │
                    │  Events │ Workflows │ Projections │ Memory │
                    └──────┬──────────────────────────┬──────────┘
                           │                          │
                    ┌──────▼──────┐            ┌──────▼──────┐
                    │   Worker    │            │  Dashboard  │
                    │             │            │             │
                    │  agent()    │            │ Time-travel │
                    │   ctx.tool  │            │ Memory view │
  agent.research ──►│   ctx.llm   │            │ Run replay  │
       event        │   ctx.memory│            └─────────────┘
                    │             │
                    │  Steps:     │
                    │  1. plan          (in-handler — pure compute)
                    │  2. tool(search)  (×N, byArgs idempotent)
                    │  3. llm.summarize (memoized — no re-bill on crash)
                    │  4. memory.append (event → projection)
                    └─────────────┘
```

## Quick Start

**Prerequisites:** Node.js 22+, pnpm, Ironflow server running (`ironflow serve --dev`). See the [installation guide](../../docs/tutorials/installation.mdx) for setup instructions.

```bash
# Build the JS SDK (required — examples link to local SDK packages)
pnpm -C ../../sdk/js build

# Install dependencies
pnpm install

# Start the worker
pnpm dev

# In another terminal — trigger a research task
ironflow emit agent.research --data '{"topic":"event sourcing best practices"}'
```

## What Happens

1. The `agent.research` event triggers the research agent function
2. The agent plans search queries based on the topic
3. Each search executes as an independent durable step
4. Results are summarized and recorded
5. The `agent-memory` projection updates with task statistics

**View results:**

```bash
# See the run in the dashboard
open http://localhost:9123

# Time-travel through the agent's execution
ironflow run list
ironflow inspect <run-id>

# Query the agent's memory projection
curl -s http://localhost:9123/api/v1/projections/agent-memory | jq '.state'
```

## Customizing

### Use real search APIs

Edit the `webSearch` tool's `handler` in `src/tools.ts`:

```typescript
import { defineTool } from "@ironflow/node/agent";
import { z } from "zod";

export const webSearch = defineTool({
  name: "web-search",
  input: z.object({ query: z.string() }),
  idempotent: "byArgs",
  handler: async ({ query }) => {
    const r = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query }),
    });
    const data = await r.json();
    return data.results.map((x: { title: string; content: string; url: string }) => ({
      title: x.title,
      snippet: x.content,
      url: x.url,
    }));
  },
});
```

`byArgs` idempotency means a replay with the same query reuses the cached result instead of re-billing the API.

### Use a real LLM

Edit `summarizeWith()` in `src/tools.ts` to call your provider directly. The closure must return an `LLMCompleteResult` — the `agent` module memoizes the result and classifies finish reasons (`refusal`, `max_tokens`, etc) into typed errors.

```typescript
import Anthropic from "@anthropic-ai/sdk";
const client = new Anthropic();

export async function summarizeWith(topic: string, sources: SearchResult[]) {
  const r = await client.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: `Summarize sources for "${topic}":\n${sources.map((s) => `- ${s.title}: ${s.snippet}`).join("\n")}`,
    }],
  });
  const text = r.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("\n");
  return {
    content: text,
    finishReason: r.stop_reason ?? undefined,
    metadata: { usage: r.usage },
  };
}
```

### Adjust Research Depth

The agent supports three depth levels via the event data:

```bash
# Quick — 2 searches
ironflow emit agent.research --data '{"topic":"GraphQL","depth":"quick"}'

# Standard — 3 searches (default)
ironflow emit agent.research --data '{"topic":"GraphQL","depth":"standard"}'

# Deep — 5 searches
ironflow emit agent.research --data '{"topic":"GraphQL","depth":"deep"}'
```

## How this differs from LangChain/CrewAI

| Feature           | LangChain/CrewAI | Ironflow                 |
| ----------------- | ---------------- | ------------------------ |
| Crash recovery    | Start over       | Resume from last step    |
| Tool call retry   | Manual           | Automatic per-step       |
| Execution history | Log files        | Structured, queryable    |
| Debugging         | Print statements | Time-travel replay       |
| Agent memory      | In-memory/DB     | Event-sourced projection |
| Infrastructure    | Python runtime   | Single binary server     |

## Related examples

- [doc-processor-agent](../agents/doc-processor-agent) — minimal `agent()` + `memory()` example used by the [Survive a Crash tutorial](../../docs/tutorials/agent-survives-crash.md).
- [code-review-agent](../agents/code-review-agent) — adds `llm()` + `approve()` for human-in-the-loop gates.
- [Agent stack comparison](../../docs/explanation/comparison-agents.md) — where Ironflow sits vs. LangGraph, Claude Agent SDK, Temporal.
