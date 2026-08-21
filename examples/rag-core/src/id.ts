import { createHash } from "node:crypto";

/** Deterministic id from parts — safe as an idempotencyKey: a step retry
 *  derives the SAME id, so the server drops the duplicate emit. */
export function stableId(...parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}
