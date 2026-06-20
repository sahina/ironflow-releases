"use client";

import { useEffect, useState, useRef } from "react";
import { ironflow, type Subscription, type SubscriptionEvent } from "@ironflow/browser";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ErrorAlert } from "@/components/error-alert";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  GitBranch,
  Grid3X3,
  Loader2,
  Check,
  X,
  Play,
  Clock,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  SkipForward,
} from "lucide-react";

// --- Types ---

interface BranchStatus {
  id: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  output?: unknown;
  error?: string;
  startedAt?: string;
  endedAt?: string;
}

interface MapItemStatus {
  id: string;
  status: "pending" | "processing" | "done" | "error" | "skipped";
  output?: unknown;
  error?: string;
}

interface SystemEvent {
  id: string;
  topic: string;
  type: string;
  timestamp: Date;
  data: unknown;
}

interface RunSummary {
  status: "completed" | "failed";
  output?: unknown;
  error?: unknown;
  startedAt?: Date;
  completedAt?: Date;
}

// --- Helpers ---

function getBranchIcon(status: BranchStatus["status"]) {
  switch (status) {
    case "pending":
      return <Clock className="h-5 w-5 text-muted-foreground" />;
    case "running":
      return <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />;
    case "completed":
      return <Check className="h-5 w-5 text-green-500" />;
    case "failed":
      return <X className="h-5 w-5 text-red-500" />;
    case "skipped":
      return <SkipForward className="h-5 w-5 text-muted-foreground" />;
  }
}

function getBranchBadgeVariant(status: BranchStatus["status"]) {
  switch (status) {
    case "pending":
      return "secondary" as const;
    case "running":
      return "default" as const;
    case "completed":
      return "default" as const;
    case "failed":
      return "destructive" as const;
    case "skipped":
      return "outline" as const;
  }
}

function extractErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
  }
  return JSON.stringify(error);
}

function formatDuration(startedAt?: string, endedAt?: string): string | null {
  if (!startedAt || !endedAt) return null;
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// --- Component ---

export default function ParallelPage() {
  // ── Parallel section state ──
  const [pConcurrency, setPConcurrency] = useState(4);
  const [pErrorMode, setPErrorMode] = useState<"failFast" | "allSettled">("failFast");
  const [pInjectError, setPInjectError] = useState(false);
  const [pBranches, setPBranches] = useState<BranchStatus[]>([]);
  const [pRunning, setPRunning] = useState(false);
  const [pRunId, setPRunId] = useState<string | null>(null);
  const [pError, setPError] = useState<string | null>(null);
  const [pEvents, setPEvents] = useState<SystemEvent[]>([]);
  const [pRunSummary, setPRunSummary] = useState<RunSummary | null>(null);
  const [pExpandedBranches, setPExpandedBranches] = useState<Set<string>>(new Set());

  // ── Map section state ──
  const [mConcurrency, setMConcurrency] = useState(3);
  const [mErrorMode, setMErrorMode] = useState<"failFast" | "allSettled">("failFast");
  const [mInjectError, setMInjectError] = useState(false);
  const [mFailAtItem, setMFailAtItem] = useState("item-3");
  const [mItems, setMItems] = useState<MapItemStatus[]>([]);
  const [mRunning, setMRunning] = useState(false);
  const [mRunId, setMRunId] = useState<string | null>(null);
  const [mError, setMError] = useState<string | null>(null);
  const [mEvents, setMEvents] = useState<SystemEvent[]>([]);
  const [mRunSummary, setMRunSummary] = useState<RunSummary | null>(null);
  const [mInput, setMInput] = useState(
    JSON.stringify(
      [
        { id: "item-1", value: 10 },
        { id: "item-2", value: 20 },
        { id: "item-3", value: 30 },
        { id: "item-4", value: 40 },
        { id: "item-5", value: 50 },
      ],
      null,
      2
    )
  );

  const pSubRef = useRef<Subscription | null>(null);
  const mSubRef = useRef<Subscription | null>(null);
  const pStartTimeRef = useRef<Date | null>(null);
  const mStartTimeRef = useRef<Date | null>(null);

  useEffect(() => {
    return () => {
      pSubRef.current?.unsubscribe();
      mSubRef.current?.unsubscribe();
    };
  }, []);

  // ── Parallel: trigger + subscribe ──
  const triggerParallel = async () => {
    setPRunning(true);
    setPError(null);
    setPEvents([]);
    setPRunSummary(null);
    setPExpandedBranches(new Set());
    pStartTimeRef.current = new Date();
    setPBranches([
      { id: "branch-a", status: "pending" },
      { id: "branch-b", status: "pending" },
      { id: "branch-c", status: "pending" },
      { id: "branch-d", status: "pending" },
    ]);

    try {
      const result = await ironflow.invoke("demo.parallel", {
        data: {
          concurrency: pConcurrency,
          onError: pErrorMode,
          injectError: pInjectError,
        },
      });

      if (result.runIds.length > 0) {
        const rid = result.runIds[0];
        setPRunId(rid);

        pSubRef.current?.unsubscribe();
        const sub = await ironflow.subscribe(`system.run.${rid}.>`, {
          replay: 100,
          onEvent: (event: SubscriptionEvent) => {
            // Activity log
            const sysEvent: SystemEvent = {
              id: event.eventId || crypto.randomUUID(),
              topic: event.topic,
              type: event.topic.split(".").pop() || "unknown",
              timestamp: new Date(),
              data: event.data,
            };
            setPEvents((prev) => [sysEvent, ...prev].slice(0, 30));

            const parts = event.topic.split(".");

            // Step-level events
            if (parts[3] === "step") {
              const stepId = parts[4];
              const eventType = parts[5];
              const dataObj =
                event.data && typeof event.data === "object"
                  ? (event.data as Record<string, unknown>)
                  : {};
              const dataStatus =
                typeof dataObj.status === "string" ? dataObj.status : "";
              const isCompleted =
                eventType === "completed" || dataStatus === "completed";
              const isFailed =
                eventType === "failed" || dataStatus === "failed";
              const errorMsg = dataObj.error != null
                ? extractErrorMessage(dataObj.error)
                : undefined;

              setPBranches((prev) =>
                prev.map((b) => {
                  if (!stepId.includes(`:${b.id}:`)) return b;
                  return {
                    ...b,
                    status: isCompleted
                      ? "completed"
                      : isFailed
                        ? "failed"
                        : "running",
                    output: isCompleted
                      ? (dataObj.output ?? event.data)
                      : b.output,
                    error: isFailed ? (errorMsg || "Unknown error") : b.error,
                    startedAt:
                      eventType === "created"
                        ? ((dataObj.startedAt as string) || new Date().toISOString())
                        : b.startedAt,
                    endedAt:
                      isCompleted || isFailed
                        ? ((dataObj.endedAt as string) || new Date().toISOString())
                        : b.endedAt,
                  };
                })
              );

              // Auto-expand failed branches
              if (isFailed) {
                const matchedBranch = ["branch-a", "branch-b", "branch-c", "branch-d"].find(
                  (bid) => stepId.includes(`:${bid}:`)
                );
                if (matchedBranch) {
                  setPExpandedBranches((prev) => new Set([...prev, matchedBranch]));
                }
              }
            }

            // Run-level events
            if (parts.length === 4 && (parts[3] === "completed" || parts[3] === "failed")) {
              setPRunning(false);
              const isFailed = parts[3] === "failed";
              const dataObj =
                event.data && typeof event.data === "object"
                  ? (event.data as Record<string, unknown>)
                  : {};

              setPRunSummary({
                status: isFailed ? "failed" : "completed",
                output: dataObj.output ?? event.data,
                error: isFailed ? (dataObj.error ?? event.data) : undefined,
                startedAt: pStartTimeRef.current || undefined,
                completedAt: new Date(),
              });

              // Mark remaining branches
              setPBranches((prev) =>
                prev.map((b) => {
                  if (b.status === "completed" || b.status === "failed") return b;
                  if (b.status === "pending") return { ...b, status: "skipped" as const };
                  // "running" branches get their final status
                  return { ...b, status: isFailed ? "failed" : "completed" };
                })
              );
            }
          },
        });
        pSubRef.current = sub;
      }
    } catch (err) {
      setPError(err instanceof Error ? err.message : "Failed to trigger");
      setPRunning(false);
    }
  };

  // ── Map: trigger + subscribe ──
  const triggerMap = async () => {
    setMRunning(true);
    setMError(null);
    setMEvents([]);
    setMRunSummary(null);
    mStartTimeRef.current = new Date();

    try {
      const items = JSON.parse(mInput);
      setMItems(
        items.map((item: { id: string }) => ({
          id: item.id,
          status: "pending" as const,
        }))
      );

      const result = await ironflow.invoke("demo.map", {
        data: {
          items,
          concurrency: mConcurrency,
          onError: mErrorMode,
          ...(mInjectError && { failAtItem: mFailAtItem }),
        },
      });

      if (result.runIds.length > 0) {
        const rid = result.runIds[0];
        setMRunId(rid);

        mSubRef.current?.unsubscribe();
        const sub = await ironflow.subscribe(`system.run.${rid}.>`, {
          replay: 100,
          onEvent: (event: SubscriptionEvent) => {
            // Activity log
            const sysEvent: SystemEvent = {
              id: event.eventId || crypto.randomUUID(),
              topic: event.topic,
              type: event.topic.split(".").pop() || "unknown",
              timestamp: new Date(),
              data: event.data,
            };
            setMEvents((prev) => [sysEvent, ...prev].slice(0, 30));

            const parts = event.topic.split(".");

            // Step-level events
            if (parts[3] === "step") {
              const stepId = parts[4];
              const eventType = parts[5];
              const dataObj =
                event.data && typeof event.data === "object"
                  ? (event.data as Record<string, unknown>)
                  : {};
              const dataStatus =
                typeof dataObj.status === "string" ? dataObj.status : "";
              const isCompleted =
                eventType === "completed" || dataStatus === "completed";
              const isFailed =
                eventType === "failed" || dataStatus === "failed";
              const errorMsg = dataObj.error != null
                ? extractErrorMessage(dataObj.error)
                : undefined;

              const match = stepId.match(/:process-items:(\d+):/);
              if (match) {
                const idx = parseInt(match[1]);
                setMItems((prev) =>
                  prev.map((item, i) =>
                    i === idx
                      ? {
                        ...item,
                        status: isCompleted
                          ? "done"
                          : isFailed
                            ? "error"
                            : "processing",
                        output: isCompleted
                          ? (dataObj.output ?? event.data)
                          : item.output,
                        error: isFailed
                          ? (errorMsg || "Unknown error")
                          : item.error,
                      }
                      : item
                  )
                );
              }
            }

            // Run-level events
            if (parts.length === 4 && (parts[3] === "completed" || parts[3] === "failed")) {
              setMRunning(false);
              const isFailed = parts[3] === "failed";
              const dataObj =
                event.data && typeof event.data === "object"
                  ? (event.data as Record<string, unknown>)
                  : {};

              setMRunSummary({
                status: isFailed ? "failed" : "completed",
                output: dataObj.output ?? event.data,
                error: isFailed ? (dataObj.error ?? event.data) : undefined,
                startedAt: mStartTimeRef.current || undefined,
                completedAt: new Date(),
              });

              setMItems((prev) =>
                prev.map((item) => {
                  if (item.status === "done" || item.status === "error") return item;
                  if (item.status === "pending") return { ...item, status: "skipped" as const };
                  // "processing" items get their final status
                  return { ...item, status: isFailed ? "error" : "done" };
                })
              );
            }
          },
        });
        mSubRef.current = sub;
      }
    } catch (err) {
      setMError(err instanceof Error ? err.message : "Failed to trigger");
      setMRunning(false);
    }
  };

  const toggleBranchExpanded = (branchId: string) => {
    setPExpandedBranches((prev) => {
      const next = new Set(prev);
      if (next.has(branchId)) next.delete(branchId);
      else next.add(branchId);
      return next;
    });
  };

  const clearParallel = () => {
    pSubRef.current?.unsubscribe();
    pSubRef.current = null;
    setPBranches([]);
    setPRunId(null);
    setPError(null);
    setPEvents([]);
    setPRunSummary(null);
    setPExpandedBranches(new Set());
    setPRunning(false);
  };

  const clearMap = () => {
    mSubRef.current?.unsubscribe();
    mSubRef.current = null;
    setMItems([]);
    setMRunId(null);
    setMError(null);
    setMEvents([]);
    setMRunSummary(null);
    setMRunning(false);
  };

  // ── Computed values ──
  const pCompletedCount = pBranches.filter((b) => b.status === "completed").length;
  const pFailedCount = pBranches.filter((b) => b.status === "failed").length;
  const pSkippedCount = pBranches.filter((b) => b.status === "skipped").length;
  const mDoneCount = mItems.filter((i) => i.status === "done").length;
  const mErrorCount = mItems.filter((i) => i.status === "error").length;
  const mSkippedCount = mItems.filter((i) => i.status === "skipped").length;

  return (
    <div className="container mx-auto py-8 px-4">
      <section className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Parallel & Map</h1>
        <p className="text-muted-foreground">
          Demonstrate <code>step.parallel()</code> and <code>step.map()</code>{" "}
          with configurable concurrency and error modes.
        </p>
      </section>

      {/* ═══════════════════════════════════════════════════════ */}
      {/* Section 1: step.parallel()                             */}
      {/* ═══════════════════════════════════════════════════════ */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold flex items-center gap-2 mb-4">
          <GitBranch className="h-5 w-5" /> step.parallel()
        </h2>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Left Column: Controls + Branch Timeline */}
          <div className="space-y-6">
            {/* Controls */}
            <Card>
              <CardHeader>
                <CardTitle>Controls</CardTitle>
                <CardDescription>
                  Execute 4 branches concurrently with configurable concurrency limit and error handling
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label>Concurrency: {pConcurrency}</Label>
                    <Slider
                      value={[pConcurrency]}
                      onValueChange={([v]) => setPConcurrency(v)}
                      min={1}
                      max={4}
                      step={1}
                      className="mt-2"
                      disabled={pRunning}
                    />
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={pInjectError}
                        onCheckedChange={(v) => setPInjectError(!!v)}
                        disabled={pRunning}
                      />
                      <Label>Inject error in branch B</Label>
                    </div>
                    {pInjectError && (
                      <div>
                        <Label>Error mode</Label>
                        <Select
                          value={pErrorMode}
                          onValueChange={(v) => setPErrorMode(v as "failFast" | "allSettled")}
                          disabled={pRunning}
                        >
                          <SelectTrigger className="mt-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="failFast">Fail Fast</SelectItem>
                            <SelectItem value="allSettled">All Settled</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground mt-1">
                          {pErrorMode === "failFast"
                            ? "The workflow run fails on first branch error. Unstarted branches are skipped. The run status is \"failed\"."
                            : "All branches run to completion regardless of errors. Errors are captured in the results array. The run status is \"completed\" even when branches fail."}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
                {pInjectError && (
                  <div className="text-xs text-muted-foreground bg-muted/50 rounded-md p-3 space-y-1.5">
                    <p className="font-medium text-foreground">
                      Expected behavior ({pErrorMode === "failFast" ? "Fail Fast" : "All Settled"}, concurrency={pConcurrency}):
                    </p>
                    {pErrorMode === "failFast" ? (
                      pConcurrency >= 4 ? (
                        <p>
                          All 4 branches start at once. Branch B fails at ~1.5s, but A (1s), C (0.8s), and D (2s)
                          are already running and complete naturally.{" "}
                          <strong>Result: 3 completed, 1 failed. Run status: failed.</strong>
                        </p>
                      ) : pConcurrency === 3 ? (
                        <p>
                          First batch starts A, B, C simultaneously. C finishes fastest (0.8s), freeing a slot
                          — D starts before B fails at 1.5s. All started branches complete naturally.{" "}
                          <strong>Result: 3 completed, 1 failed. Run status: failed.</strong>
                        </p>
                      ) : pConcurrency === 2 ? (
                        <p>
                          A and B start together. A completes at 1s, freeing a slot — C starts.
                          B fails at 1.5s, setting the cancelled flag. C was already running and completes.
                          D never starts because the flag is checked before it begins.{" "}
                          <strong>Result: 2 completed, 2 failed. Run status: failed.</strong>
                        </p>
                      ) : (
                        <p>
                          Branches run one at a time. A completes (1s), then B starts and fails (1.5s).
                          failFast sets the cancelled flag, so C and D never start.{" "}
                          <strong>Result: 1 completed, 3 failed. Run status: failed.</strong>
                        </p>
                      )
                    ) : (
                      <p>
                        All branches run to completion regardless of errors. Branch B fails at ~1.5s,
                        but its error is captured as a value in the results array instead of stopping execution.
                        A, C, and D all complete successfully.{" "}
                        <strong>Result: 3 completed, 1 failed. Run status: completed.</strong>{" "}
                        The key difference from Fail Fast: the run itself succeeds.
                      </p>
                    )}
                  </div>
                )}

                <div className="flex gap-2">
                  <Button onClick={triggerParallel} disabled={pRunning}>
                    <Play className="h-4 w-4" />
                    {pRunning ? "Running..." : "Run Parallel"}
                  </Button>
                  {(pRunId || pBranches.length > 0) && !pRunning && (
                    <Button variant="outline" onClick={clearParallel}>
                      <RotateCcw className="h-4 w-4" />
                      Clear
                    </Button>
                  )}
                </div>

                {pRunId && (
                  <div className="text-sm space-y-1">
                    <div>
                      <span className="text-muted-foreground">Run ID: </span>
                      <code className="bg-muted px-2 py-1 rounded text-xs">{pRunId}</code>
                    </div>
                  </div>
                )}

                <ErrorAlert message={pError} />
              </CardContent>
            </Card>

            {/* Branch Timeline */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Branch Timeline
                  {pBranches.length > 0 && (
                    <Badge variant="secondary">{pBranches.length}</Badge>
                  )}
                </CardTitle>
                <CardDescription>Execution progress for each parallel branch</CardDescription>
              </CardHeader>
              <CardContent>
                {pBranches.length === 0 ? (
                  <p className="text-muted-foreground text-sm text-center py-8">
                    Run a parallel workflow to see branches here.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {pBranches.map((branch, index) => {
                      const duration = formatDuration(branch.startedAt, branch.endedAt);
                      const isExpanded = pExpandedBranches.has(branch.id);
                      const hasDetail = branch.output != null || branch.error;

                      return (
                        <div key={branch.id} className="relative">
                          {/* Connector line */}
                          {index < pBranches.length - 1 && (
                            <div
                              className={`absolute left-2.5 top-8 w-0.5 h-[calc(100%+8px)] ${branch.status === "completed"
                                ? "bg-green-500"
                                : branch.status === "failed"
                                  ? "bg-red-500"
                                  : "bg-muted"
                                }`}
                            />
                          )}

                          <div className="flex items-start gap-4">
                            {/* Icon */}
                            <div className="shrink-0 w-5 h-5 mt-1 z-10 bg-background">
                              {getBranchIcon(branch.status)}
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <span className="font-medium font-mono text-sm">
                                  {branch.id}
                                </span>
                                <Badge variant={getBranchBadgeVariant(branch.status)}>
                                  {branch.status}
                                </Badge>
                                {duration && (
                                  <span className="text-xs text-muted-foreground tabular-nums">
                                    {duration}
                                  </span>
                                )}
                                {hasDetail && (
                                  <button
                                    onClick={() => toggleBranchExpanded(branch.id)}
                                    className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
                                  >
                                    {isExpanded ? (
                                      <ChevronDown className="h-4 w-4" />
                                    ) : (
                                      <ChevronRight className="h-4 w-4" />
                                    )}
                                  </button>
                                )}
                              </div>

                              {/* Error message (always visible when failed) */}
                              {branch.status === "failed" && branch.error && (
                                <div className="text-sm text-destructive bg-destructive/10 p-2 rounded mt-1">
                                  {branch.error}
                                </div>
                              )}

                              {/* Output (expandable) */}
                              {isExpanded && branch.output != null && (
                                <pre className="text-xs bg-muted p-2 rounded overflow-x-auto mt-2">
                                  {JSON.stringify(branch.output, null, 2)}
                                </pre>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right Column: Run Summary + Activity Log */}
          <div className="space-y-6">
            {/* Run Summary */}
            <Card className={pRunSummary
              ? pRunSummary.status === "completed"
                ? "border-t-4 border-t-green-500"
                : "border-t-4 border-t-red-500"
              : ""
            }>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Run Summary
                  {pRunSummary && (
                    <Badge
                      variant={pRunSummary.status === "completed" ? "default" : "destructive"}
                    >
                      {pRunSummary.status === "completed" ? "Run Completed" : "Run Failed"}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!pRunSummary && !pRunning ? (
                  <p className="text-muted-foreground text-sm text-center py-8">
                    Summary will appear after the run completes.
                  </p>
                ) : !pRunSummary && pRunning ? (
                  <div className="flex items-center gap-2 py-8 justify-center">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Running...</span>
                  </div>
                ) : pRunSummary ? (
                  <div className="space-y-3">
                    {/* Stats */}
                    <div className="flex items-center gap-4 text-sm">
                      {pCompletedCount > 0 && (
                        <span className="flex items-center gap-1 text-green-600">
                          <Check className="h-4 w-4" />
                          {pCompletedCount} completed
                        </span>
                      )}
                      {pFailedCount > 0 && (
                        <span className="flex items-center gap-1 text-red-600">
                          <X className="h-4 w-4" />
                          {pFailedCount} failed
                        </span>
                      )}
                      {pSkippedCount > 0 && (
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <SkipForward className="h-4 w-4" />
                          {pSkippedCount} skipped
                        </span>
                      )}
                      {pRunSummary.startedAt != null && pRunSummary.completedAt != null && (
                        <span className="text-muted-foreground tabular-nums">
                          Total:{" "}
                          {(
                            (pRunSummary.completedAt.getTime() -
                              pRunSummary.startedAt.getTime()) /
                            1000
                          ).toFixed(1)}
                          s
                        </span>
                      )}
                    </div>

                    {/* Error */}
                    {pRunSummary.error != null && (
                      <div className="text-sm text-destructive bg-destructive/10 p-3 rounded flex items-start gap-2">
                        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                        <span>{extractErrorMessage(pRunSummary.error)}</span>
                      </div>
                    )}

                    {/* Final output */}
                    {pRunSummary.output != null && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Final Output</Label>
                        <pre className="text-xs bg-muted p-2 rounded overflow-x-auto mt-1 max-h-75 overflow-y-auto">
                          {JSON.stringify(pRunSummary.output, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            {/* Activity Log */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Activity Log
                  <Badge variant="secondary">{pEvents.length}</Badge>
                </CardTitle>
                <CardDescription>Raw system events for this run</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-100 overflow-y-auto">
                  {pEvents.length === 0 ? (
                    <p className="text-muted-foreground text-sm text-center py-8">
                      Events will appear here when the workflow runs.
                    </p>
                  ) : (
                    pEvents.map((evt) => (
                      <div
                        key={evt.id}
                        className="border rounded-lg p-3 space-y-1 animate-in fade-in slide-in-from-top-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <Badge variant="outline">{evt.type}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {evt.timestamp.toLocaleTimeString()}
                          </span>
                        </div>
                        <code className="text-xs text-muted-foreground block truncate">
                          {evt.topic}
                        </code>
                        {evt.data != null && (
                          <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
                            {JSON.stringify(evt.data, null, 2)}
                          </pre>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════ */}
      {/* Section 2: step.map()                                  */}
      {/* ═══════════════════════════════════════════════════════ */}
      <section>
        <h2 className="text-xl font-semibold flex items-center gap-2 mb-4">
          <Grid3X3 className="h-5 w-5" /> step.map()
        </h2>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Left Column: Controls + Items Grid */}
          <div className="space-y-6">
            {/* Controls */}
            <Card>
              <CardHeader>
                <CardTitle>Controls</CardTitle>
                <CardDescription>
                  Map over items with parallel processing and configurable concurrency
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label>Input items (JSON array)</Label>
                    <Textarea
                      value={mInput}
                      onChange={(e) => setMInput(e.target.value)}
                      className="mt-1 font-mono text-xs"
                      rows={6}
                      disabled={mRunning}
                    />
                  </div>
                  <div className="space-y-4">
                    <div>
                      <Label>Concurrency: {mConcurrency}</Label>
                      <Slider
                        value={[mConcurrency]}
                        onValueChange={([v]) => setMConcurrency(v)}
                        min={1}
                        max={5}
                        step={1}
                        className="mt-2"
                        disabled={mRunning}
                      />
                    </div>
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={mInjectError}
                          onCheckedChange={(v) => setMInjectError(!!v)}
                          disabled={mRunning}
                        />
                        <Label>Inject error at</Label>
                        <Select
                          value={mFailAtItem}
                          onValueChange={setMFailAtItem}
                          disabled={mRunning || !mInjectError}
                        >
                          <SelectTrigger className="w-28 h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="item-1">item-1</SelectItem>
                            <SelectItem value="item-2">item-2</SelectItem>
                            <SelectItem value="item-3">item-3</SelectItem>
                            <SelectItem value="item-4">item-4</SelectItem>
                            <SelectItem value="item-5">item-5</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {mInjectError && (
                        <div>
                          <Label>Error mode</Label>
                          <Select
                            value={mErrorMode}
                            onValueChange={(v) => setMErrorMode(v as "failFast" | "allSettled")}
                            disabled={mRunning}
                          >
                            <SelectTrigger className="mt-1">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="failFast">Fail Fast</SelectItem>
                              <SelectItem value="allSettled">All Settled</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground mt-1">
                            {mErrorMode === "failFast"
                              ? "The workflow run fails on first item error. Unstarted items are skipped. The run status is \"failed\"."
                              : "All items are processed regardless of errors. Errors are captured in the results array. The run status is \"completed\" even when items fail."}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {mInjectError && (() => {
                  const itemIndex = parseInt(mFailAtItem.split("-")[1]);
                  const totalItems = 5;
                  return (
                    <div className="text-xs text-muted-foreground bg-muted/50 rounded-md p-3 space-y-1.5">
                      <p className="font-medium text-foreground">
                        Expected behavior ({mErrorMode === "failFast" ? "Fail Fast" : "All Settled"}, concurrency={mConcurrency}):
                      </p>
                      {mErrorMode === "failFast" ? (
                        mConcurrency >= totalItems ? (
                          <p>
                            All {totalItems} items start at once. {mFailAtItem} fails at ~1s, but all other items
                            are already processing and complete naturally.{" "}
                            <strong>Result: {totalItems - 1} processed, 1 error. Run status: failed.</strong>
                          </p>
                        ) : itemIndex <= mConcurrency ? (
                          <p>
                            First batch starts items 1–{mConcurrency} simultaneously. {mFailAtItem} is in this batch
                            and fails at ~1s, setting the cancelled flag. Items already running complete, but
                            remaining items ({totalItems - mConcurrency} not yet started) are skipped.{" "}
                            <strong>Result: {mConcurrency - 1} processed, {totalItems - mConcurrency + 1} failed. Run status: failed.</strong>
                          </p>
                        ) : (
                          <p>
                            Items are processed in batches of {mConcurrency}. Items before {mFailAtItem} complete
                            successfully. When {mFailAtItem} starts and fails, the cancelled flag is set.
                            Items already running in the same batch complete, but remaining items are skipped.{" "}
                            <strong>Run status: failed.</strong>
                          </p>
                        )
                      ) : (
                        <p>
                          All {totalItems} items are processed regardless of errors. {mFailAtItem} fails at ~1s,
                          but its error is captured in the results array. All other items complete successfully.{" "}
                          <strong>Result: {totalItems - 1} processed, 1 error. Run status: completed.</strong>{" "}
                          The key difference from Fail Fast: the run itself succeeds.
                        </p>
                      )}
                    </div>
                  );
                })()}

                <div className="flex gap-2">
                  <Button onClick={triggerMap} disabled={mRunning}>
                    <Play className="h-4 w-4" />
                    {mRunning ? "Processing..." : "Run Map"}
                  </Button>
                  {(mRunId || mItems.length > 0) && !mRunning && (
                    <Button variant="outline" onClick={clearMap}>
                      <RotateCcw className="h-4 w-4" />
                      Clear
                    </Button>
                  )}
                </div>

                {mRunId && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Run ID: </span>
                    <code className="bg-muted px-2 py-1 rounded text-xs">{mRunId}</code>
                  </div>
                )}

                <ErrorAlert message={mError} />
              </CardContent>
            </Card>

            {/* Items Grid */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Items
                  {mItems.length > 0 && (
                    <Badge variant="secondary">
                      {mDoneCount + mErrorCount + mSkippedCount}/{mItems.length}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>Processing status for each item</CardDescription>
              </CardHeader>
              <CardContent>
                {mItems.length === 0 ? (
                  <p className="text-muted-foreground text-sm text-center py-8">
                    Run a map workflow to see items here.
                  </p>
                ) : (
                  <>
                    {/* Progress bar */}
                    <div className="mb-4">
                      <div className="flex justify-between text-xs text-muted-foreground mb-1">
                        <span>Progress</span>
                        <span>{mDoneCount + mErrorCount + mSkippedCount} / {mItems.length}</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${mErrorCount > 0 ? "bg-red-500" : "bg-green-500"
                            }`}
                          style={{
                            width: `${((mDoneCount + mErrorCount + mSkippedCount) / mItems.length) * 100}%`,
                          }}
                        />
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                      {mItems.map((item) => (
                        <div
                          key={item.id}
                          className={`border rounded-lg p-3 transition-colors ${item.status === "done"
                            ? "border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-950"
                            : item.status === "processing"
                              ? "border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950"
                              : item.status === "error"
                                ? "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950"
                                : item.status === "skipped"
                                  ? "border-muted bg-muted/30"
                                  : ""
                            }`}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            {item.status === "done" ? (
                              <Check className="h-4 w-4 text-green-500 shrink-0" />
                            ) : item.status === "processing" ? (
                              <Loader2 className="h-4 w-4 text-blue-500 animate-spin shrink-0" />
                            ) : item.status === "error" ? (
                              <X className="h-4 w-4 text-red-500 shrink-0" />
                            ) : item.status === "skipped" ? (
                              <SkipForward className="h-4 w-4 text-muted-foreground shrink-0" />
                            ) : (
                              <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                            )}
                            <span className="font-mono text-sm">{item.id}</span>
                            <Badge
                              variant={
                                item.status === "done"
                                  ? "default"
                                  : item.status === "processing"
                                    ? "secondary"
                                    : item.status === "error"
                                      ? "destructive"
                                      : "outline"  /* pending + skipped */
                              }
                              className="ml-auto"
                            >
                              {item.status}
                            </Badge>
                          </div>

                          {/* Output preview */}
                          {item.status === "done" && item.output != null && (
                            <pre className="text-xs bg-muted p-1.5 rounded overflow-x-auto mt-1">
                              {JSON.stringify(item.output, null, 2)}
                            </pre>
                          )}

                          {/* Error */}
                          {item.status === "error" && item.error && (
                            <p className="text-xs text-destructive mt-1">{item.error}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right Column: Run Summary + Activity Log */}
          <div className="space-y-6">
            {/* Run Summary */}
            <Card className={mRunSummary
              ? mRunSummary.status === "completed"
                ? "border-t-4 border-t-green-500"
                : "border-t-4 border-t-red-500"
              : ""
            }>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Run Summary
                  {mRunSummary && (
                    <Badge
                      variant={mRunSummary.status === "completed" ? "default" : "destructive"}
                    >
                      {mRunSummary.status === "completed" ? "Run Completed" : "Run Failed"}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!mRunSummary && !mRunning ? (
                  <p className="text-muted-foreground text-sm text-center py-8">
                    Summary will appear after the run completes.
                  </p>
                ) : !mRunSummary && mRunning ? (
                  <div className="flex items-center gap-2 py-8 justify-center">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Processing items...</span>
                  </div>
                ) : mRunSummary ? (
                  <div className="space-y-3">
                    {/* Stats */}
                    <div className="flex items-center gap-4 text-sm">
                      {mDoneCount > 0 && (
                        <span className="flex items-center gap-1 text-green-600">
                          <Check className="h-4 w-4" />
                          {mDoneCount} processed
                        </span>
                      )}
                      {mErrorCount > 0 && (
                        <span className="flex items-center gap-1 text-red-600">
                          <X className="h-4 w-4" />
                          {mErrorCount} errors
                        </span>
                      )}
                      {mSkippedCount > 0 && (
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <SkipForward className="h-4 w-4" />
                          {mSkippedCount} skipped
                        </span>
                      )}
                      {mRunSummary.startedAt != null && mRunSummary.completedAt != null && (
                        <span className="text-muted-foreground tabular-nums">
                          Total:{" "}
                          {(
                            (mRunSummary.completedAt.getTime() -
                              mRunSummary.startedAt.getTime()) /
                            1000
                          ).toFixed(1)}
                          s
                        </span>
                      )}
                    </div>

                    {/* Error */}
                    {mRunSummary.error != null && (
                      <div className="text-sm text-destructive bg-destructive/10 p-3 rounded flex items-start gap-2">
                        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                        <span>{extractErrorMessage(mRunSummary.error)}</span>
                      </div>
                    )}

                    {/* Final output */}
                    {mRunSummary.output != null && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Final Output</Label>
                        <pre className="text-xs bg-muted p-2 rounded overflow-x-auto mt-1 max-h-75 overflow-y-auto">
                          {JSON.stringify(mRunSummary.output, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            {/* Activity Log */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Activity Log
                  <Badge variant="secondary">{mEvents.length}</Badge>
                </CardTitle>
                <CardDescription>Raw system events for this run</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-100 overflow-y-auto">
                  {mEvents.length === 0 ? (
                    <p className="text-muted-foreground text-sm text-center py-8">
                      Events will appear here when the map runs.
                    </p>
                  ) : (
                    mEvents.map((evt) => (
                      <div
                        key={evt.id}
                        className="border rounded-lg p-3 space-y-1 animate-in fade-in slide-in-from-top-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <Badge variant="outline">{evt.type}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {evt.timestamp.toLocaleTimeString()}
                          </span>
                        </div>
                        <code className="text-xs text-muted-foreground block truncate">
                          {evt.topic}
                        </code>
                        {evt.data != null && (
                          <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
                            {JSON.stringify(evt.data, null, 2)}
                          </pre>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>
    </div>
  );
}
