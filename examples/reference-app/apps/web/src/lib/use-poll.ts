"use client";

import { useEffect, useRef, useState } from "react";

/**
 * How often a view that watches processes re-asks.
 *
 * Short on purpose: a presenter crashes a worker in front of an audience and
 * needs to see it go. The payment worker heartbeats every 3s, so this samples
 * faster than the thing it is watching changes.
 */
export const POLL_MS = 2_000;

/**
 * Re-runs `look` on a timer and returns its latest answer.
 *
 * `initial` is what the view shows before the first answer, and what it falls
 * back to when `look` throws — which is why every caller here uses a value that
 * means "not known" rather than one that means "not running".
 *
 * `look` must be stable, or the timer restarts on every render. Callers wrap it
 * in `useCallback` over the client they read through. Nothing enforces that —
 * this app runs no eslint — so it is a contract, not a rule.
 */
export function usePoll<T>(look: () => Promise<T>, initial: T): T {
  const [value, setValue] = useState<T>(initial);
  // A ref, not a dependency. `initial` is a fallback value rather than a
  // trigger, and as a dependency it would restart the timer every time a caller
  // passed a fresh object literal.
  const fallback = useRef(initial);
  fallback.current = initial;

  useEffect(() => {
    let live = true;
    const tick = async () => {
      try {
        const next = await look();
        if (live) setValue(next);
      } catch {
        if (live) setValue(fallback.current);
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [look]);

  return value;
}
