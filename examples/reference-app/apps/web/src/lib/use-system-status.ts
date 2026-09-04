"use client";

import { useCallback } from "react";

import { useIronflow } from "@/components/ironflow-provider";
import { parseHeartbeat, type Heartbeat } from "@/lib/heartbeat";
import { serviceRows, type ServiceRow } from "@/lib/service-status";
import { usePoll } from "@/lib/use-poll";
import { parseWorkers, type WorkerSummary } from "@/lib/workers";

type Probe = {
  engineReachable: boolean;
  workers: WorkerSummary[];
  notificationsHeartbeat: Heartbeat | undefined;
};

const UNREACHABLE: Probe = { engineReachable: false, workers: [], notificationsHeartbeat: undefined };

/**
 * The five rows `/system` renders, refreshed on a timer.
 *
 * `readModelConnected` is the caller's own claim about its projection
 * subscription: this hook cannot observe another component's subscription, and
 * the page that renders the browser row is the one that holds it.
 */
export function useSystemStatus(readModelConnected: boolean | undefined): ServiceRow[] {
  const ironflow = useIronflow();

  const look = useCallback(async (): Promise<Probe> => {
    // Health first and alone: if the engine is unreachable, the worker list and
    // the KV read tell us nothing about the processes behind them, and
    // reporting them as gone would be a claim this page cannot support.
    if (!(await ironflow.health().catch(() => false))) return UNREACHABLE;
    const [workers, heartbeat] = await Promise.all([
      ironflow.listWorkers().catch(() => []),
      ironflow.notificationsHeartbeat().catch(() => undefined),
    ]);
    return {
      engineReachable: true,
      workers: parseWorkers(workers),
      notificationsHeartbeat: parseHeartbeat(heartbeat),
    };
  }, [ironflow]);

  const probe = usePoll(look, UNREACHABLE);
  return serviceRows({ ...probe, readModelConnected, now: Date.now() });
}
