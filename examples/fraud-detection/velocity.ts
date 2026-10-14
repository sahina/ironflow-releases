import { IronflowError, NonRetryableError, type KVBucketHandle } from "@ironflow/node";

// Retrying the step re-reads the revision instead of repeating a stale CAS write.
function retryOnConflict(error: unknown): never {
  if (error instanceof IronflowError && error.status === 412) {
    throw new IronflowError(error.message, {
      code: error.code,
      status: error.status,
      retryable: true,
      cause: error,
    });
  }
  throw error;
}

/**
 * Atomic read-increment via KV store CAS (check-and-set). Returns the new count.
 * Uses the revision number to prevent lost updates when two transactions for
 * the same card race concurrently.
 */
export async function incrementVelocity(bucket: KVBucketHandle, cardId: string): Promise<number> {
  const key = `${cardId}.1h`;
  let entry;
  try {
    entry = await bucket.getJSON(key);
  } catch (error) {
    if (!(error instanceof IronflowError) || error.status !== 404) throw error;
  }

  if (!entry) {
    // Key doesn't exist yet — first transaction for this card. A missing bucket
    // also reads as 404 here; create() then fails with "bucket not found".
    // A racing create retries the step, which reads the winner's revision.
    await bucket.create(key, 1).catch(retryOnConflict);
    return 1;
  }

  if (typeof entry.value !== "number") {
    throw new NonRetryableError("Velocity counter must be a number");
  }
  // CAS: only succeeds if revision hasn't changed since our read
  await bucket.update(key, entry.value + 1, entry.revision).catch(retryOnConflict);
  return entry.value + 1;
}
