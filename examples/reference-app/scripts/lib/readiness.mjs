// Readiness probes for the reference-app supervisor.
//
// Every probe is a poll with its own deadline and its own message. A missing
// port file and an engine that never becomes ready are different failures, and
// a presenter staring at a hung terminal needs to be told which one happened.
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

/**
 * Poll `probe` until it returns a truthy value or the deadline passes.
 * A throwing probe counts as "not yet"; its last message goes into the timeout.
 */
export async function waitFor(what, probe, { timeoutMs = 30_000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  for (;;) {
    try {
      const value = await probe();
      if (value) return value;
      lastError = undefined;
    } catch (error) {
      lastError = error;
    }
    if (Date.now() >= deadline) {
      const because = lastError ? `: ${lastError.message}` : "";
      throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}${because}`);
    }
    await sleep(intervalMs);
  }
}

/**
 * Wait for a JSON file to exist and parse. The engine writes its port file with
 * a plain (non-atomic) write, so a torn read is normal — JSON.parse throws and
 * the next poll picks up the complete file.
 */
export function waitForJsonFile(path, opts) {
  return waitFor(path, () => JSON.parse(readFileSync(path, "utf8")), opts);
}

/**
 * Wait for an HTTP endpoint to answer 2xx.
 *
 * Each probe carries its own AbortSignal: waitFor only checks its deadline
 * *between* probes, so a server that accepts the connection and never answers
 * would otherwise hang past the timeout the caller asked for.
 */
export function waitForHttpOk(url, { fetchImpl = fetch, probeTimeoutMs = 5_000, ...opts } = {}) {
  return waitFor(
    url,
    async () => {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(probeTimeoutMs) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return true;
    },
    opts,
  );
}
