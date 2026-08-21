import { createFunction } from "@ironflow/node";
import { EVENTS, type EvalVerdict } from "../events.js";
import { comparePointer, readPointer } from "../src/db.js";
import { searchDocuments } from "../src/retriever.js";

/**
 * W4 — the gate.
 *
 * A saga rather than a plain function because advancing the pointer is a real
 * side effect on the thing users query, and the verification that follows it
 * can fail. Compensation is a durable step, so a crash between "advanced" and
 * "verified" still rolls back on resume rather than leaving a bad index live.
 */
export const promoteIndex = createFunction(
  {
    id: "promote-index",
    description:
      "Advances the live index pointer once an eval passes, verifies the promoted index actually answers, and rolls the pointer back if it does not.",
    triggers: [{ event: EVENTS.EvalPassed }],
    mode: "pull",
    recording: true,
    // One promotion at a time. The compare-and-swap below is the real
    // correctness guarantee, but serialising also keeps the run history
    // readable instead of full of lost races.
    concurrency: { limit: 1 },
  },
  async ({ event, step, logger }) => {
    const verdict = event.data as EvalVerdict;

    const previous = await step.run("read-pointer", async () => readPointer());

    if (previous >= verdict.indexVersion) {
      // Already promoted, or a newer index won the race. Advancing would move
      // the pointer backwards.
      logger.info("pointer already at or beyond this version — nothing to do", {
        previous,
        candidate: verdict.indexVersion,
      });
      return { promoted: false, reason: "not-newer", previous };
    }

    const advanced = await step.run("advance-pointer", async () =>
      comparePointer(previous, verdict.indexVersion),
    );

    if (!advanced) {
      // Someone moved the pointer between read and write. Not ours to fix.
      logger.info("pointer moved under us — another promotion won", {
        expected: previous,
        candidate: verdict.indexVersion,
      });
      return { promoted: false, reason: "lost-race", previous };
    }

    // Verify against the LIVE pointer, which the previous step just moved.
    // Reading the shadow index here would verify nothing.
    //
    // The try/catch is the point: verification can THROW (embed() raises on any
    // non-200 from Voyage, the pool can reject) far more easily than it can
    // return zero. Without this, the throw propagates, the run fails, and the
    // pointer stays advanced to an index nothing verified — the exact outcome
    // this saga exists to prevent.
    let live = 0;
    let failure: unknown;
    try {
      live = await step.run("verify-live", async () => {
        const hits = await searchDocuments({ query: "total revenue", limit: 5 });
        return hits.length;
      });
    } catch (err) {
      failure = err;
    }

    if (failure !== undefined || live === 0) {
      await step.run("compensate", async () => {
        // CAS again: only roll back if the pointer is still the one we set.
        // A blind write here would undo a newer, good promotion.
        const restored = await comparePointer(verdict.indexVersion, previous);
        if (!restored) {
          logger.warn("rollback skipped — pointer already moved on", {
            expected: verdict.indexVersion,
          });
        }
        return restored;
      });
      logger.error("promoted index failed verification — rolled back", {
        indexVersion: verdict.indexVersion,
        restored: previous,
        reason: failure !== undefined ? String(failure) : "no hits",
      });
      return {
        promoted: false,
        reason: failure !== undefined ? "verification-threw" : "verification-empty",
        previous,
      };
    }

    logger.info("index promoted", {
      indexVersion: verdict.indexVersion,
      previous,
      hits: live,
    });
    return { promoted: true, indexVersion: verdict.indexVersion, previous };
  },
);

/**
 * The other half of the gate: a failing eval leaves the pointer alone.
 *
 * Its own function rather than a branch inside promoteIndex so that "we chose
 * not to promote" is a first-class run in the history, with a reason attached,
 * instead of an absence someone has to notice.
 */
export const recordRegression = createFunction(
  {
    id: "record-regression",
    description:
      "Records that an index version failed its eval and was not promoted.",
    triggers: [{ event: EVENTS.EvalRegressed }],
    mode: "pull",
    recording: true,
  },
  async ({ event, logger }) => {
    const verdict = event.data as EvalVerdict;
    logger.warn("index NOT promoted — eval regressed", {
      indexVersion: verdict.indexVersion,
      numeric: `${verdict.numericPassed}/${verdict.numericTotal}`,
      failing: verdict.failingCsv,
    });
    return { promoted: false, indexVersion: verdict.indexVersion };
  },
);
