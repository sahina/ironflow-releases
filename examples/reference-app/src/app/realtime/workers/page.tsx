"use client";

import { useEffect, useState, useCallback } from "react";
import { ironflow, type SubscriptionEvent } from "@ironflow/browser";
import { useIronflow } from "@/components/ironflow-provider";
import { useSystemSubscription } from "@/hooks/use-system-subscription";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ErrorAlert } from "@/components/error-alert";
import { HardDrive, RefreshCw, Terminal, Play, Trash2, Loader2 } from "lucide-react";

interface WorkerInfo {
  id: string;
  hostname: string;
  function_ids: string[];
  max_concurrent: number;
  labels: Record<string, string>;
  active_jobs: number;
  registered_at: string;
  last_heartbeat: string;
  transport: string;
}

interface WorkerRun {
  id: string;
  functionId: string;
  status: string;
  startedAt: Date;
  output?: unknown;
}

const WORKER_FUNCTIONS = [
  { id: "data-pipeline", event: "worker.data-pipeline", label: "Data Pipeline", description: "Multi-step: fetch → transform → validate (~7s)" },
  { id: "batch-processor", event: "worker.batch-process", label: "Batch Processor", description: "Parallel item processing with step.map" },
  { id: "scheduled-report", event: "cron.scheduled-report", label: "Scheduled Report", description: "Auto-fires every 30s via cron" },
];

const WORKER_FUNCTION_IDS = new Set(WORKER_FUNCTIONS.map((f) => f.id));

export default function WorkersPage() {
  const [workers, setWorkers] = useState<WorkerInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [workerEvents, setWorkerEvents] = useState<Array<{ type: string; workerId: string; timestamp: Date }>>([]);
  // Presence from system.worker.{id}.* frames (#1723). GET /api/v1/workers
  // reports every worker it has ever seen with no health field, so these frames
  // are the only thing that flips the badge to "Missed heartbeat" while a
  // worker is dying, and to "Disconnected" once it is evicted. A tab opened
  // mid-degradation shows "Connected" until the next transition — edge-only
  // delivery carries no initial state.
  const [presence, setPresence] = useState<Record<string, { health: string; draining: boolean }>>({});

  // New state
  const [runs, setRuns] = useState<WorkerRun[]>([]);
  const [triggeringFn, setTriggeringFn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);

  const { isConnected } = useIronflow();

  const fetchWorkers = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await ironflow.listWorkers() as WorkerInfo[];
      setWorkers(list);
      setLastRefresh(new Date());
    } catch (err) {
      console.error("Failed to fetch workers:", err);
    }
    setIsLoading(false);
  }, []);

  const triggerFunction = useCallback(async (fn: typeof WORKER_FUNCTIONS[number]) => {
    setTriggeringFn(fn.id);
    setError(null);
    try {
      await ironflow.invoke(fn.event, { data: {} });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to trigger function");
    }
    setTriggeringFn(null);
  }, []);

  useEffect(() => {
    if (!isConnected) return;
    let cancelled = false;
    // Deferred to avoid a synchronous setState in the effect body.
    void Promise.resolve().then(() => {
      if (!cancelled) fetchWorkers();
    });
    return () => {
      cancelled = true;
    };
  }, [isConnected, fetchWorkers]);

  const isSubscribed = useSystemSubscription("system.worker.>", (event: SubscriptionEvent) => {
    // Worker IDs are client-supplied and unvalidated, so a worker named
    // "a.health" yields a 5-segment topic whose parts[3] reads as an event
    // type for a different worker. Only fixed-shape
    // system.worker.{id}.{event} topics are routed.
    const parts = event.topic.split(".");
    if (parts.length !== 4) return;
    const workerId = parts[2];
    const eventType = parts[3];

    setWorkerEvents((prev) => [
      { type: eventType, workerId, timestamp: new Date() },
      ...prev,
    ].slice(0, 20));

    if (eventType === "health") {
      const data = event.data as { health?: string; draining?: boolean };
      setPresence((prev) => ({
        ...prev,
        [workerId]: { health: data.health ?? "healthy", draining: data.draining ?? false },
      }));
      return;
    }

    if (eventType === "connected") {
      setPresence((prev) => {
        const next = { ...prev };
        delete next[workerId];
        return next;
      });
      fetchWorkers();
      return;
    }

    if (eventType === "disconnected") {
      // Terminal, not a reset. GET /api/v1/workers never evicts a worker, so
      // clearing presence here would drop the row back to its default
      // "Connected" badge — a dead worker going green, which reads as
      // recovery.
      setPresence((prev) => ({
        ...prev,
        [workerId]: { health: "disconnected", draining: false },
      }));
      fetchWorkers();
    }
  });

  const isRunSubbed = useSystemSubscription("system.run.>", (event: SubscriptionEvent) => {
    const parts = event.topic.split(".");
    // Run-level events: system.run.{runId}.{eventType} (4 parts)
    if (parts.length !== 4) return;

    const runId = parts[2];
    const eventType = parts[3];
    const data = event.data as { functionId?: string; id?: string; status?: string; output?: unknown };

    if (!data.functionId || !WORKER_FUNCTION_IDS.has(data.functionId)) return;

    if (eventType === "updated" && data.status === "running") {
      setRuns((prev) => {
        // Avoid duplicates
        if (prev.some((r) => r.id === runId)) return prev;
        return [
          { id: runId, functionId: data.functionId!, status: "running", startedAt: new Date() },
          ...prev,
        ].slice(0, 30);
      });
    } else if (eventType === "completed") {
      setRuns((prev) => {
        const exists = prev.some((r) => r.id === runId);
        if (exists) {
          return prev.map((r) => r.id === runId ? { ...r, status: "completed", output: data.output } : r);
        }
        // Run completed without a preceding "updated" event — add it directly
        return [
          { id: runId, functionId: data.functionId!, status: "completed", startedAt: new Date(), output: data.output },
          ...prev,
        ].slice(0, 30);
      });
    } else if (eventType === "failed") {
      setRuns((prev) => {
        const exists = prev.some((r) => r.id === runId);
        if (exists) {
          return prev.map((r) => r.id === runId ? { ...r, status: "failed" } : r);
        }
        return [
          { id: runId, functionId: data.functionId!, status: "failed", startedAt: new Date() },
          ...prev,
        ].slice(0, 30);
      });
    }
  });

  const functionLabel = (fnId: string) =>
    WORKER_FUNCTIONS.find((f) => f.id === fnId)?.label ?? fnId;

  const statusColor = (status: string) => {
    switch (status) {
      case "running": return "default" as const;
      case "completed": return "secondary" as const;
      case "failed": return "destructive" as const;
      default: return "outline" as const;
    }
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <section className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Workers</h1>
        <p className="text-muted-foreground mb-4">
          View connected pull-mode workers, trigger jobs, and watch execution results in real-time.
        </p>
        <Alert>
          <Terminal className="h-4 w-4" />
          <AlertDescription>
            Run <code>pnpm run worker</code> in a second terminal to see a worker appear here.
          </AlertDescription>
        </Alert>
      </section>

      {/* Connected Workers - full width */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                Connected Workers <Badge variant="secondary">{workers.length}</Badge>
              </CardTitle>
              <CardDescription>
                {lastRefresh
                  ? `Last refreshed: ${lastRefresh.toLocaleTimeString()}`
                  : "Loading..."}
              </CardDescription>
            </div>
            <Button onClick={fetchWorkers} variant="outline" size="sm" disabled={isLoading}>
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {workers.length === 0 ? (
            <div className="text-center py-12 space-y-4">
              <HardDrive className="h-12 w-12 mx-auto text-muted-foreground" />
              <div>
                <h3 className="text-lg font-medium">No Workers Connected</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Start a worker to see it appear here:
                </p>
                <pre className="bg-muted p-3 rounded mt-2 text-sm text-left inline-block">
                  cd examples/reference-app{"\n"}pnpm run worker
                </pre>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {workers.map((worker) => (
                <div key={worker.id} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <HardDrive className="h-4 w-4" />
                      <span className="font-mono text-sm font-medium">{worker.id}</span>
                    </div>
                    {(() => {
                      const p = presence[worker.id];
                      if (p?.health === "disconnected") {
                        return <Badge variant="destructive">Disconnected</Badge>;
                      }
                      if (p?.draining) return <Badge variant="outline">Draining</Badge>;
                      if (p?.health === "unhealthy") {
                        return <Badge variant="secondary">Missed heartbeat</Badge>;
                      }
                      return <Badge variant="default">Connected</Badge>;
                    })()}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Hostname:</span>{" "}
                      <span className="font-mono">{worker.hostname || "—"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Transport:</span>{" "}
                      <Badge variant="outline">{worker.transport}</Badge>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Active jobs:</span>{" "}
                      <span className="font-mono">{worker.active_jobs}/{worker.max_concurrent}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Last heartbeat:</span>{" "}
                      <span className="text-xs">{new Date(worker.last_heartbeat).toLocaleTimeString()}</span>
                    </div>
                  </div>

                  <div>
                    <span className="text-sm text-muted-foreground">Functions: </span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {worker.function_ids.map((fn) => (
                        <Badge key={fn} variant="secondary" className="text-xs">{fn}</Badge>
                      ))}
                    </div>
                  </div>

                  {worker.labels && Object.keys(worker.labels).length > 0 && (
                    <div>
                      <span className="text-sm text-muted-foreground">Labels: </span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {Object.entries(worker.labels).map(([k, v]) => (
                          <Badge key={k} variant="outline" className="text-xs">{k}={v}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Trigger Jobs + Live Run Feed */}
      <div className="grid gap-6 lg:grid-cols-2 mb-6">
        {/* Trigger Jobs */}
        <Card>
          <CardHeader>
            <CardTitle>Trigger Jobs</CardTitle>
            <CardDescription>
              Send events to trigger worker functions
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ErrorAlert message={error} />
            {WORKER_FUNCTIONS.map((fn) => (
              <div key={fn.id} className="flex items-center justify-between border rounded-lg p-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm">{fn.label}</div>
                  <div className="text-xs text-muted-foreground">{fn.description}</div>
                  {fn.id === "scheduled-report" && (
                    <div className="text-xs text-muted-foreground mt-1 italic">
                      Auto-fires via cron — manual trigger also available
                    </div>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-3 shrink-0"
                  disabled={workers.length === 0 || triggeringFn !== null}
                  onClick={() => triggerFunction(fn)}
                >
                  {triggeringFn === fn.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                </Button>
              </div>
            ))}
            {workers.length === 0 && (
              <p className="text-xs text-muted-foreground text-center">
                Connect a worker to enable triggering.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Live Run Feed */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  Live Run Feed <Badge variant="secondary">{runs.length}</Badge>
                </CardTitle>
                <CardDescription>
                  Real-time execution results from worker functions
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <div className={`h-2 w-2 rounded-full ${isRunSubbed ? "bg-green-500" : "bg-gray-300"}`} />
                  <span className="text-xs text-muted-foreground">
                    {isRunSubbed ? "Listening" : "Not connected"}
                  </span>
                </div>
                {runs.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => { setRuns([]); setExpandedRun(null); }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {runs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Trigger a job or wait for a cron run to appear here.
              </p>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {runs.map((run) => (
                  <div key={run.id} className="border rounded-lg p-2.5 space-y-1.5">
                    <div className="flex items-center gap-2 text-xs">
                      <Badge variant="outline" className="text-xs">{functionLabel(run.functionId)}</Badge>
                      <Badge variant={statusColor(run.status)} className="text-xs">
                        {run.status === "running" && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                        {run.status}
                      </Badge>
                      <code className="text-muted-foreground truncate flex-1">{run.id.slice(0, 12)}...</code>
                      <span className="text-muted-foreground shrink-0">{run.startedAt.toLocaleTimeString()}</span>
                    </div>
                    {run.status === "completed" && run.output !== undefined && (
                      <div>
                        <button
                          className="text-xs text-muted-foreground hover:text-foreground underline"
                          onClick={() => setExpandedRun(expandedRun === run.id ? null : run.id)}
                        >
                          {expandedRun === run.id ? "Hide output" : "Show output"}
                        </button>
                        {expandedRun === run.id && (
                          <pre className="mt-1.5 bg-muted p-2 rounded text-xs overflow-x-auto max-h-40">
                            {JSON.stringify(run.output, null, 2)}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Worker Events - full width, bottom */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Worker Events <Badge variant="secondary">{workerEvents.length}</Badge>
          </CardTitle>
          <CardDescription>
            Real-time worker connect/disconnect events
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 mb-4">
            <div className={`h-2 w-2 rounded-full ${isSubscribed ? "bg-green-500" : "bg-gray-300"}`} />
            <span className="text-xs text-muted-foreground">
              {isSubscribed ? "Listening" : "Not connected"}
            </span>
          </div>
          {workerEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Worker events will appear here.
            </p>
          ) : (
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {workerEvents.map((evt, i) => (
                <div key={i} className="text-xs p-2 border rounded flex items-center gap-2">
                  <Badge
                    variant={evt.type === "connected" ? "default" : "destructive"}
                    className="text-xs"
                  >
                    {evt.type}
                  </Badge>
                  <code className="truncate flex-1">{evt.workerId}</code>
                  <span className="text-muted-foreground">{evt.timestamp.toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
