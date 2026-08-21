/** The event contract. The vector index is a pure function of these events. */
export const EVENTS = {
  /** Emitted by the CLI to start an ingest run. */
  IngestRequested: "rag.ingest.requested",
  /**
   * One per chunk, embedding included. Carrying the vector in the event is a
   * deliberate trade: events are heavier (~13KB of floats each), but a
   * projection rebuild replays to a full index without one embedding-API
   * call. It also probes Ironflow's payload-size ceiling — see the gap log.
   */
  ChunkEmbedded: "rag.chunk.embedded",
  /** Completion marker per document — visible in the dashboard and inspect. */
  DocumentIndexed: "rag.document.indexed",
} as const;

export interface ChunkEmbedded {
  chunkId: string;
  docId: string;
  seq: number;
  heading: string;
  text: string;
  embedding: number[];
  contentHash: string;
}

export interface DocumentIndexed {
  docId: string;
  contentHash: string;
  chunks: number;
}
