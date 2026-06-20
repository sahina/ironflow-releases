"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { ironflow, type Subscription, type SubscriptionEvent } from "@ironflow/browser";
import { Check, Clock, Loader2, Play, Radio, RotateCcw, Zap } from "lucide-react";
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
import { Alert, AlertDescription } from "@/components/ui/alert";

type InvokeMode = "sync" | "async";

interface StepInfo {
  id: string;
  name: string;
  status: "pending" | "running" | "completed";
  output?: unknown;
}

interface SystemEvent {
  id: string;
  topic: string;
  type: string;
  timestamp: Date;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

export default function InvokeDemoPage() {
  const [mode, setMode] = useState<InvokeMode>("sync");
  const [runId, setRunId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [result, setResult] = useState<any>(null);
  const [steps, setSteps] = useState<StepInfo[]>([]);
  const [systemEvents, setSystemEvents] = useState<SystemEvent[]>([]);
  const subscriptionRef = useRef<Subscription | null>(null);

  useEffect(() => {
    return () => {
      subscriptionRef.current?.unsubscribe();
    };
  }, []);

  const subscribeToRun = useCallback(async (rid: string) => {
    subscriptionRef.current?.unsubscribe();
    try {
      const sub = await ironflow.subscribe(`system.run.${rid}.>`, {
        replay: 100,
        onEvent: (event: SubscriptionEvent) => {
          setSystemEvents((prev) => [
            { id: event.eventId || crypto.randomUUID(), topic: event.topic, type: event.topic.split(".").pop() || "unknown", timestamp: new Date(), data: event.data },
            ...prev,
          ].slice(0, 30));

          const parts = event.topic.split(".");
          if (parts.length >= 6 && parts[3] === "step") {
            const stepId = parts[4];
            const eventType = parts[5];
            const dataObj = event.data && typeof event.data === "object" ? (event.data as Record<string, unknown>) : {};

            setSteps((prev) => {
              const existing = prev.find((s) => s.id === stepId);
              const status = eventType === "completed" || (dataObj.status === "completed") ? "completed" as const : "running" as const;
              const output = status === "completed" ? (dataObj.output ?? event.data) : undefined;
              if (existing) {
                return prev.map((s) => (s.id === stepId ? { ...s, status, output: output ?? s.output } : s));
              }
              return [...prev, { id: stepId, name: (dataObj.name as string) || stepId, status, output }];
            });
          }

          if (event.topic.endsWith(".completed") && !event.topic.includes(".step.")) {
            setIsRunning(false);
            setSteps((prev) => prev.map((s) => (s.status === "running" ? { ...s, status: "completed" } : s)));
          } else if (event.topic.endsWith(".failed") && !event.topic.includes(".step.")) {
            setIsRunning(false);
            setError("Workflow failed");
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
  }, []);

  const startWorkflow = async () => {
    setIsRunning(true);
    setError(null);
    setResult(null);
    setSteps([]);
    setSystemEvents([]);

    try {
      const triggerResult = await ironflow.invoke("demo.invoke", {
        data: { mode },
      });
      if (triggerResult.runIds.length > 0) {
        const rid = triggerResult.runIds[0];
        setRunId(rid);
        await subscribeToRun(rid);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start workflow");
      setIsRunning(false);
    }
  };

  const reset = () => {
    subscriptionRef.current?.unsubscribe();
    subscriptionRef.current = null;
    setRunId(null);
    setIsRunning(false);
    setError(null);
    setResult(null);
    setSteps([]);
    setSystemEvents([]);
  };

  // Extract result from completed run events
  useEffect(() => {
    const completedRunEvent = systemEvents.find(
      (e) => e.topic.endsWith(".completed") && !e.topic.includes(".step.")
    );
    if (completedRunEvent && completedRunEvent.data) {
      const data = completedRunEvent.data as Record<string, unknown>;
      setResult(data.output ?? completedRunEvent.data);
    }
  }, [systemEvents]);

  return (
    <div className="container mx-auto py-8 px-4">
      <section className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Cross-Function Invocation</h1>
        <p className="text-muted-foreground mb-4">
          Call other functions from within a workflow using <code>step.invoke()</code> for synchronous
          calls or <code>step.invokeAsync()</code> for fire-and-forget.
        </p>
        <Alert>
          <Zap className="h-4 w-4" />
          <AlertDescription>
            The parent workflow invokes <code>calculate-total</code> as a child function. In sync mode,
            it waits for the result. In async mode, it gets the child run ID immediately.
          </AlertDescription>
        </Alert>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          {/* Controls */}
          <Card>
            <CardHeader>
              <CardTitle>Invocation Mode</CardTitle>
              <CardDescription>Choose how the parent function calls the child</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Button
                  variant={mode === "sync" ? "default" : "outline"}
                  onClick={() => setMode("sync")}
                  disabled={isRunning}
                >
                  Sync (step.invoke)
                </Button>
                <Button
                  variant={mode === "async" ? "default" : "outline"}
                  onClick={() => setMode("async")}
                  disabled={isRunning}
                >
                  Async (step.invokeAsync)
                </Button>
              </div>

              <div className="flex gap-2">
                <Button onClick={startWorkflow} disabled={isRunning}>
                  <Play className="h-4 w-4" />
                  {isRunning ? "Running..." : "Run Parent Workflow"}
                </Button>
                {!isRunning && runId && (
                  <Button variant="outline" onClick={reset}>
                    <RotateCcw className="h-4 w-4" />
                    Reset
                  </Button>
                )}
              </div>

              {runId && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Parent Run ID: </span>
                  <code className="bg-muted px-2 py-1 rounded text-xs">{runId}</code>
                </div>
              )}

              <ErrorAlert message={error} />
            </CardContent>
          </Card>

          {/* Result */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Result
                {result && <Check className="h-4 w-4 text-green-500" />}
              </CardTitle>
              <CardDescription>
                {mode === "sync"
                  ? "The child function's return value"
                  : "The child run ID (fire-and-forget)"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {result ? (
                <pre className="text-sm bg-muted p-4 rounded overflow-x-auto">
                  {JSON.stringify(result, null, 2)}
                </pre>
              ) : (
                <p className="text-muted-foreground text-sm text-center py-8">
                  {isRunning ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {mode === "sync" ? "Waiting for child function result..." : "Invoking child function..."}
                    </span>
                  ) : (
                    "Run the workflow to see the result."
                  )}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Step Timeline */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Step Timeline
                <Badge variant="secondary">{steps.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {steps.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-8">
                  {isRunning ? "Waiting for step events..." : "Steps will appear here."}
                </p>
              ) : (
                <div className="space-y-3">
                  {steps.map((step) => (
                    <div key={step.id} className="flex items-center gap-3 p-3 border rounded-lg">
                      {step.status === "completed" ? (
                        <Check className="h-5 w-5 text-green-500 flex-shrink-0" />
                      ) : step.status === "running" ? (
                        <Loader2 className="h-5 w-5 text-blue-500 animate-spin flex-shrink-0" />
                      ) : (
                        <Clock className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm">{step.name}</span>
                          <Badge variant={step.status === "completed" ? "default" : "secondary"}>
                            {step.status}
                          </Badge>
                        </div>
                        {step.output != null && (
                          <pre className="text-xs bg-muted p-1 rounded mt-1 overflow-x-auto">
                            {JSON.stringify(step.output, null, 2)}
                          </pre>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              System Events
              <Badge variant="secondary">{systemEvents.length}</Badge>
            </CardTitle>
            <CardDescription>Raw events from the parent run</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-[600px] overflow-y-auto">
              {systemEvents.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-8">
                  {isRunning ? "Waiting for events..." : "System events will appear here."}
                </p>
              ) : (
                systemEvents.map((event) => (
                  <div key={event.id} className="border rounded-lg p-3 space-y-2 animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <Badge variant="outline">{event.type}</Badge>
                      <span className="text-xs text-muted-foreground">{event.timestamp.toLocaleTimeString()}</span>
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

      {/* Reference */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Invoke Reference</CardTitle>
          <CardDescription>Comparing synchronous and asynchronous cross-function calls</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Badge variant="outline" className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                step.invoke()
              </Badge>
              <p className="text-sm text-muted-foreground">
                Synchronous call. Pauses the parent workflow until the child function completes and
                returns the result. Supports a configurable timeout.
              </p>
              <pre className="text-xs bg-muted p-2 rounded">{`const result = await step.invoke(\n  "calculate-total",\n  { items },\n  { timeout: "30s" }\n)`}</pre>
            </div>
            <div className="space-y-2">
              <Badge variant="outline" className="bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
                step.invokeAsync()
              </Badge>
              <p className="text-sm text-muted-foreground">
                Fire-and-forget. Returns the child run ID immediately without waiting for completion.
                The child runs independently.
              </p>
              <pre className="text-xs bg-muted p-2 rounded">{`const { runId } = await step.invokeAsync(\n  "calculate-total",\n  { items }\n)`}</pre>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
