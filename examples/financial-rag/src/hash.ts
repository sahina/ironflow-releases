import { createHash } from "node:crypto";

export interface SourceObject {
  key: string;
  hash: string;
}

/** Hex SHA-256 of a document's bytes. The identity of a filing version. */
export function hashContent(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * A deterministic ID derived from the artifact's own coordinates.
 *
 * Never use randomUUID() for an artifact emitted from inside a durable step.
 * A step retries as a unit: if emit 400 of 600 fails, emits 1-399 fire again,
 * and random IDs make those duplicates rather than repeats. Deterministic IDs
 * make a retry idempotent, and doubling as the event's idempotencyKey means
 * the duplicate is dropped before it ever reaches a projection.
 */
export function stableId(...parts: (string | number)[]): string {
  // JSON.stringify, not a separator-join: ("a b","c") and ("a","b c") must not
  // collide, and financial row labels contain spaces constantly.
  return createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, 32);
}

/**
 * Objects that are new or whose content changed since the last ingest.
 *
 * Deliberately one-directional: an object that disappeared from the source is
 * NOT returned. Filings are append-only facts — a document vanishing from a
 * bucket is not evidence it was retracted, and deleting the read model on that
 * basis would lose history the entity stream is specifically there to keep.
 */
export function diffChangedSet(
  source: SourceObject[],
  seen: Map<string, string>,
): SourceObject[] {
  return source.filter((obj) => seen.get(obj.key) !== obj.hash);
}
