import { createProjection } from "@ironflow/node";

// ── Agent Memory Projection ────────────────────────────────────
//
// Derived from `agent.research.completed` events written by the
// agent's memory.append() call. Survives any node restart — the
// projection rebuilds deterministically from history.
//
// Query the projection state:
//   curl http://localhost:9123/api/v1/projections/agent-memory | jq
//
// ────────────────────────────────────────────────────────────────

interface AgentMemoryState {
  totalTasks: number;
  topics: string[];
  lastResearchAt: string | null;
}

export const agentMemory = createProjection({
  name: "agent-memory",
  events: ["agent.research.completed"],
  initialState: (): AgentMemoryState => ({
    totalTasks: 0,
    topics: [],
    lastResearchAt: null,
  }),
  handler: (
    state: AgentMemoryState,
    event: { name: string; data: unknown },
  ): AgentMemoryState => {
    // Guard event.data — projections must not crash on a malformed
    // event. Reduce to a no-op when the payload is missing fields the
    // projection cares about.
    const data = (event.data ?? {}) as { topic?: string; completedAt?: string };
    return {
      totalTasks: state.totalTasks + 1,
      topics: data.topic ? [...state.topics, data.topic] : state.topics,
      // `data.completedAt` only — projection handlers must be pure so
      // rebuilds from history reproduce the same state. `new Date()`
      // would diverge between live processing and replay.
      lastResearchAt: data.completedAt ?? state.lastResearchAt,
    };
  },
});
