"use client";

import { useCallback } from "react";

import { useIronflow } from "@/components/ironflow-provider";
import { usePoll } from "@/lib/use-poll";
import { parseWorkers, paymentWorkerPresent } from "@/lib/workers";

/**
 * Whether the payment worker is running, or `undefined` while the answer is
 * unknown — before the first reply, and whenever the engine cannot be reached.
 *
 * `undefined` is not a third display state. "Gone" is a claim about the worker
 * and an unreachable engine does not support it; the view says nothing instead,
 * and the queue's own alert already reports the engine.
 */
export function useWorkerPresence(): boolean | undefined {
  const ironflow = useIronflow();
  const look = useCallback(
    async () => paymentWorkerPresent(parseWorkers(await ironflow.listWorkers()), new Date()),
    [ironflow],
  );
  return usePoll<boolean | undefined>(look, undefined);
}
