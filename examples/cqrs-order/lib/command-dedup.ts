// Command dedup backed by the Ironflow SDK's CommandDedup primitive.
//
// Walkthrough Step 3 — command idempotency using ironflow.commandDedup().
// The SDK handles bucket creation, JSON serialization, base64 decoding,
// and the claim-first atomicity pattern internally.

import { type CommandDedup } from "@ironflow/node";
import { ironflow } from "./ironflow-server";

export type DedupEntry = {
  orderId: string;
  claimedAt: string;
  completedAt?: string;
  entityVersion?: number;
};

// Create once at module load — reuse across all requests.
// Bucket creation is lazy — happens on the first operation.
const _dedup: CommandDedup<DedupEntry> =
  ironflow.commandDedup<DedupEntry>("order-commands");

export const commandDedup = {
  /**
   * Atomic claim. Returns null when the caller wins the race (proceed).
   * A prior entry can be pending. Only a completed entry is a cached result;
   * the handler reconciles pending claims against the stream.
   */
  async tryClaim(commandId: string, claim: DedupEntry): Promise<DedupEntry | null> {
    return _dedup.tryClaim(commandId, claim);
  },

  /**
   * Finalize the claim with the command's result. Subsequent retries
   * with the same commandId will receive this value.
   */
  async finalize(commandId: string, entry: DedupEntry): Promise<void> {
    return _dedup.finalize(commandId, entry);
  },
};
