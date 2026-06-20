"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { ironflow, type Subscription, type SubscriptionEvent } from "@ironflow/browser";
import { AlertCircle, Check, Clock, Loader2, Play, Radio, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorAlert } from "@/components/error-alert";
import { Alert, AlertDescription } from "@/components/ui/alert";

type StepStatus = "pending" | "running" | "completed" | "failed" | "timed_out";

interface Step {
  id: string;
  name: string;
  status: StepStatus;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result?: any;
}

interface SystemEvent {
  id: string;
  topic: string;
  type: string;
  timestamp: Date;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

function getStepIcon(status: StepStatus) {
  switch (status) {
    case "pending":
      return <Clock className="h-5 w-5 text-muted-foreground" />;
    case "running":
      return <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />;
    case "completed":
      return <Check className="h-5 w-5 text-green-500" />;
    case "failed":
    case "timed_out":
      return <AlertCircle className="h-5 w-5 text-red-500" />;
  }
}

function getStatusBadgeVariant(status: StepStatus) {
  switch (status) {
    case "pending":
      return "secondary" as const;
    case "running":
      return "default" as const;
    case "completed":
      return "default" as const;
    case "failed":
    case "timed_out":
      return "destructive" as const;
  }
}

export default function TimeoutsDemoPage() {
  const [slowStepMs, setSlowStepMs] = useState(2000);
  const [perStepTimeout, setPerStepTimeout] = useState("5s");
  const [steps, setSteps] = useState<Step[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [systemEvents, setSystemEvents] = useState<SystemEvent[]>([]);
  const subscriptionRef = useRef<Subscription | null>(null);

  useEffect(() => {
    return () => {
      subscriptionRef.current?.unsubscribe();
    };
  }, []);

  const updateStepFromEvent = useCallback((topic: string, data: unknown) => {
    const parts = topic.split(".");
    if (parts.length >= 6 && parts[3] === "step") {
      const stepId = parts[4];
      const eventType = parts[5];
      const dataObj = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
      const dataStatus = typeof dataObj.status === "string" ? dataObj.status : "";

      const resolveStatus = (fallback: StepStatus): StepStatus => {
        if (eventType === "completed" || dataStatus === "completed") return "completed";
        if (dataStatus === "timed_out" || eventType === "timed_out") return "timed_out";
        if (dataStatus === "failed" || eventType === "failed") return "failed";
        if (dataStatus === "running") return "running";
        return fallback;
      };

      setSteps((prev) => {
        const existing = prev.find((s) => s.id === stepId);
        if (existing) {
          const newStatus = resolveStatus(existing.status);
          return prev.map((s) =>
            s.id === stepId
              ? { ...s, status: newStatus, result: newStatus === "completed" ? (dataObj.output ?? data) : s.result }
              : s
          );
        }
        const newStatus = resolveStatus("running");
        return [
          ...prev,
          {
            id: stepId,
            name: (dataObj.name as string) || stepId,
            status: newStatus,
            result: newStatus === "completed" ? (dataObj.output ?? data) : undefined,
          },
        ];
      });
    }
  }, []);

  const subscribeToRunEvents = useCallback(
    async (rid: string) => {
      subscriptionRef.current?.unsubscribe();
      try {
        const sub = await ironflow.subscribe(`system.run.${rid}.>`, {
          replay: 100,
          onEvent: (event: SubscriptionEvent) => {
            const newEvent: SystemEvent = {
              id: event.eventId || crypto.randomUUID(),
              topic: event.topic,
              type: event.topic.split(".").pop() || "unknown",
              timestamp: new Date(),
              data: event.data,
            };
            setSystemEvents((prev) => [newEvent, ...prev].slice(0, 30));
            updateStepFromEvent(event.topic, event.data);

            if (event.topic.endsWith(".completed") && !event.topic.includes(".step.")) {
              setIsRunning(false);
              setSteps((prev) =>
                prev.map((s) => (s.status === "running" ? { ...s, status: "completed" } : s))
              );
            } else if (event.topic.endsWith(".failed") && !event.topic.includes(".step.")) {
              setIsRunning(false);
            }
          },
          onError: (err) => {
            console.error("Subscription error:", err.code, err.message, err);
            setError(`Subscription error: ${err.message || "Unknown"} (${err.code || "?"})`);
          },
        });
        subscriptionRef.current = sub;
      } catch (err) {
        console.error("Failed to subscribe:", err);
      }
    },
    [updateStepFromEvent]
  );

  const startWorkflow = async () => {
    setIsRunning(true);
    setError(null);
    setSteps([]);
    setSystemEvents([]);

    try {
      const result = await ironflow.invoke("demo.timeout", {
        data: { slowStepMs, perStepTimeout },
      });
      if (result.runIds.length > 0) {
        const rid = result.runIds[0];
        setRunId(rid);
        await subscribeToRunEvents(rid);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start workflow");
      setIsRunning(false);
    }
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <section className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Step-Level Timeouts</h1>
        <p className="text-muted-foreground mb-4">
          Configure timeouts at the function level or per individual step. When a step exceeds
          its timeout, it fails with a timeout error.
        </p>
        <Alert>
          <Timer className="h-4 w-4" />
          <AlertDescription>
            This workflow has a function-level <code>stepTimeout: &quot;10s&quot;</code> default.
            Individual steps can override with their own <code>timeout</code> option.
          </AlertDescription>
        </Alert>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          {/* Controls */}
          <Card>
            <CardHeader>
              <CardTitle>Timeout Controls</CardTitle>
              <CardDescription>Configure step delays and per-step timeout overrides</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Slow step delay</Label>
                <div className="flex flex-wrap gap-2">
                  {[
                    { value: 1000, label: "1s" },
                    { value: 3000, label: "3s" },
                    { value: 8000, label: "8s" },
                    { value: 12000, label: "12s" },
                  ].map((opt) => (
                    <Button
                      key={opt.value}
                      variant={slowStepMs === opt.value ? "default" : "outline"}
                      size="sm"
                      onClick={() => setSlowStepMs(opt.value)}
                      disabled={isRunning}
                    >
                      {opt.label}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  How long the &quot;timed-step&quot; takes to complete
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="timeout">Per-step timeout override</Label>
                <Input
                  id="timeout"
                  value={perStepTimeout}
                  onChange={(e) => setPerStepTimeout(e.target.value)}
                  placeholder='e.g., "5s", "15s", "1m"'
                  disabled={isRunning}
                />
                <p className="text-xs text-muted-foreground">
                  Overrides the function default for the &quot;timed-step&quot;
                </p>
              </div>

              <Button onClick={startWorkflow} disabled={isRunning}>
                <Play className="h-4 w-4" />
                {isRunning ? "Running..." : "Run Workflow"}
              </Button>

              {runId && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Run ID: </span>
                  <code className="bg-muted px-2 py-1 rounded text-xs">{runId}</code>
                </div>
              )}

              <ErrorAlert message={error} />
            </CardContent>
          </Card>

          {/* Step Timeline */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Step Timeline
                <Badge variant="secondary">{steps.length}</Badge>
              </CardTitle>
              <CardDescription>Steps discovered from real-time events</CardDescription>
            </CardHeader>
            <CardContent>
              {steps.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-8">
                  {isRunning ? "Waiting for step events..." : "Run a workflow to see steps appear here."}
                </p>
              ) : (
                <div className="space-y-4">
                  {steps.map((step, index) => (
                    <div key={step.id} className="relative">
                      {index < steps.length - 1 && (
                        <div
                          className={`absolute left-[10px] top-[32px] w-0.5 h-[calc(100%+8px)] ${
                            step.status === "completed"
                              ? "bg-green-500"
                              : step.status === "timed_out" || step.status === "failed"
                                ? "bg-red-500"
                                : "bg-muted"
                          }`}
                        />
                      )}
                      <div className="flex items-start gap-4">
                        <div className="flex-shrink-0 w-5 h-5 mt-1 z-10 bg-background">
                          {getStepIcon(step.status)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="font-medium font-mono text-sm">{step.name}</span>
                            <Badge variant={getStatusBadgeVariant(step.status)}>
                              {step.status === "timed_out" ? "timed out" : step.status}
                            </Badge>
                          </div>
                          {step.result && (
                            <pre className="text-xs bg-muted p-2 rounded overflow-x-auto mt-2">
                              {JSON.stringify(step.result, null, 2)}
                            </pre>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column: System Events */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                System Events
                <Badge variant="secondary">{systemEvents.length}</Badge>
              </CardTitle>
              <CardDescription>Raw events received from the server</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 max-h-[600px] overflow-y-auto">
                {systemEvents.length === 0 ? (
                  <p className="text-muted-foreground text-sm text-center py-8">
                    {isRunning ? "Waiting for events..." : "System events will appear here when you run a workflow."}
                  </p>
                ) : (
                  systemEvents.map((event) => (
                    <div
                      key={event.id}
                      className="border rounded-lg p-3 space-y-2 animate-in fade-in slide-in-from-top-2"
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <Badge variant="outline">{event.type}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {event.timestamp.toLocaleTimeString()}
                        </span>
                      </div>
                      <code className="text-xs text-muted-foreground block truncate">{event.topic}</code>
                      {event.data && (
                        <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
                          {JSON.stringify(event.data, null, 2)}
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

      {/* Reference Card */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Timeout Reference</CardTitle>
          <CardDescription>How step-level timeouts work in Ironflow</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Badge variant="outline" className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                stepTimeout (function)
              </Badge>
              <p className="text-sm text-muted-foreground">
                Default timeout for all <code>step.run()</code> calls in the function. Set in the function config.
              </p>
              <pre className="text-xs bg-muted p-2 rounded">stepTimeout: &quot;10s&quot;</pre>
            </div>
            <div className="space-y-2">
              <Badge variant="outline" className="bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
                timeout (per-step)
              </Badge>
              <p className="text-sm text-muted-foreground">
                Override for a specific step. Takes precedence over the function default.
              </p>
              <pre className="text-xs bg-muted p-2 rounded">{`step.run("name", fn, { timeout: "5s" })`}</pre>
            </div>
            <div className="space-y-2">
              <Badge variant="outline" className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                StepTimeoutError
              </Badge>
              <p className="text-sm text-muted-foreground">
                Thrown when a step exceeds its timeout. The workflow can catch this or let it fail the run.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
