import { createProjection } from "@ironflow/node";
import { EVENTS } from "./events.js";

// ── Memory Projection ──────────────────────────────────────────
//
// Every memory.append() in the agent goes through an entity stream
// (`agent-memory:{docId}`). This projection rebuilds doc state from
// those events deterministically — survives any node restart, and
// rebuilds identically from history.
//
// Query the projection state:
//   curl http://localhost:9123/api/v1/projections/doc-processor-memory | jq
//
// ────────────────────────────────────────────────────────────────

interface DocState {
  docId: string;
  status: "ocr" | "classified" | "published";
  category?: string;
  processedAt: string;
}

type MemoryState = Record<string, DocState>;

export const docMemory = createProjection({
  name: "doc-processor-memory",
  events: [EVENTS.DocProcessed],
  initialState: (): MemoryState => ({}),
  handler: (state: MemoryState, event: { name: string; data: unknown }): MemoryState => {
    const data = event.data as DocState;
    if (!data?.docId) return state;
    return { ...state, [data.docId]: data };
  },
});
