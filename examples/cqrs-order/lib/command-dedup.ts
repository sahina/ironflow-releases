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
   * Returns the prior entry when another request already claimed this
   * commandId (dedup hit — return the prior result to the caller).
   *
   * The returned entry may have entityVersion undefined if the winner
   * has not yet called finalize(). Use `?? 0` as a safe fallback.
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

  /**
   * Release the claim so an honest retry can proceed after a handler failure.
   * Only call this in a catch block — never after finalize() succeeds.
   */
  async release(commandId: string): Promise<void> {
    return _dedup.release(commandId);
  },
};
