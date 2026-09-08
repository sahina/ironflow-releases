"use client";

import { useCallback } from "react";

import { useIronflow } from "@/components/ironflow-provider";
import { parseRuns, runsForEvents, type RunSummary } from "@/lib/runs";
import { usePoll } from "@/lib/use-poll";

const NONE: RunSummary[] = [];

/**
 * The recent runs started by the facts in one open timeline.
 *
 * `enabled` is what makes it lazy. Every order on the operations page holds a
 * timeline, and loading runs for all of them on render would ask the engine for
 * links nobody has looked at. It follows the run list rather than reading it
 * once, because an open timeline is usually an order still in flight — a list
 * fetched at the moment of opening is stale by the time the capture lands.
 *
 * An engine that cannot answer leaves the list empty, which renders no link —
 * never a broken one.
 */
export function useRunsForEvents(eventIds: readonly string[], enabled: boolean): RunSummary[] {
  const ironflow = useIronflow();

  const look = useCallback(async (): Promise<RunSummary[]> => {
    if (!enabled) return NONE;
    return parseRuns(await ironflow.listRuns());
  }, [enabled, ironflow]);

  return runsForEvents(usePoll(look, NONE), eventIds);
}
