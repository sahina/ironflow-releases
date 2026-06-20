"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { ironflow, type Subscription, type SubscriptionEvent } from "@ironflow/browser";
import { Check, Clock, Loader2, Pause, Play, Send, Radio, Timer } from "lucide-react";
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

type StepStatus = "pending" | "running" | "completed" | "waiting";

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
    case "waiting":
      return <Pause className="h-5 w-5 text-yellow-500" />;
    case "completed":
      return <Check className="h-5 w-5 text-green-500" />;
  }
}

function getStatusBadgeVariant(status: StepStatus) {
  switch (status) {
    case "pending":
      return "secondary" as const;
    case "running":
      return "default" as const;
    case "waiting":
      return "outline" as const;
    case "completed":
      return "default" as const;
  }
}

export default function StepsDemoPage() {
  const [steps, setSteps] = useState<Step[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [systemEvents, setSystemEvents] = useState<SystemEvent[]>([]);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [approvalSent, setApprovalSent] = useState(false);

  // sleepUntil demo state
  const [sleepOffset, setSleepOffset] = useState<number>(10);
  const [sleepTargetTime, setSleepTargetTime] = useState<Date | null>(null);
  const [sleepCountdown, setSleepCountdown] = useState<number>(0);
  const [sleepRunId, setSleepRunId] = useState<string | null>(null);
  const [sleepCompleted, setSleepCompleted] = useState<boolean>(false);
  const [sleepRunning, setSleepRunning] = useState<boolean>(false);
  const [sleepEvents, setSleepEvents] = useState<SystemEvent[]>([]);

  const subscriptionRef = useRef<Subscription | null>(null);
  const sleepSubscriptionRef = useRef<Subscription | null>(null);

  // Cleanup subscriptions on unmount
  useEffect(() => {
    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe();
      }
      if (sleepSubscriptionRef.current) {
        sleepSubscriptionRef.current.unsubscribe();
      }
    };
  }, []);

  // Countdown timer for sleepUntil demo
  useEffect(() => {
    if (!sleepTargetTime || sleepCompleted) return;

    const updateCountdown = () => {
      const remaining = Math.max(
        0,
        Math.ceil((sleepTargetTime.getTime() - Date.now()) / 1000)
      );
      setSleepCountdown(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);

    return () => clearInterval(interval);
  }, [sleepTargetTime, sleepCompleted]);

  const updateStepFromEvent = useCallback((topic: string, data: unknown) => {
    // Parse topic: system.run.{runId}.step.{stepId}.{event}
    const parts = topic.split(".");
    if (parts.length >= 6 && parts[3] === "step") {
      const stepId = parts[4];
      const eventType = parts[5];

      // Derive status from the event data's status field (server sends actual step status)
      const dataObj = data && typeof data === "object" ? data as Record<string, unknown> : {};
      const dataStatus = typeof dataObj.status === "string" ? dataObj.status : "";

      const resolveStatus = (fallback: StepStatus): StepStatus => {
        if (eventType === "completed" || dataStatus === "completed") return "completed";
        if (dataStatus === "waiting") return "waiting";
        if (dataStatus === "running") return "running";
        return fallback;
      };

      setSteps((prev) => {
        const existingStep = prev.find((s) => s.id === stepId);
        if (existingStep) {
          const newStatus = resolveStatus(existingStep.status);
          return prev.map((s) =>
            s.id === stepId
              ? {
                  ...s,
                  status: newStatus,
                  result: newStatus === "completed" ? (dataObj.output ?? data) : s.result,
                }
              : s
          );
        } else {
          const newStatus = resolveStatus("running");
          return [
            ...prev,
            {
              id: stepId,
              name: dataObj.name as string || stepId,
              status: newStatus,
              result: newStatus === "completed" ? (dataObj.output ?? data) : undefined,
            },
          ];
        }
      });
    }
  }, []);

  const subscribeToRunEvents = useCallback(
    async (runIdToSubscribe: string) => {
      if (!ironflow.isConfigured) {
        return;
      }

      // Unsubscribe from previous run
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe();
      }

      try {
        // Subscribe to all events for this run
        const pattern = `system.run.${runIdToSubscribe}.>`;
        const subscription = await ironflow.subscribe(pattern, {
          replay: 100,
          onEvent: (event: SubscriptionEvent) => {
            // Add to system events log
            const newEvent: SystemEvent = {
              id: event.eventId || crypto.randomUUID(),
              topic: event.topic,
              type: event.topic.split(".").pop() || "unknown",
              timestamp: new Date(),
              data: event.data,
            };
            setSystemEvents((prev) => [newEvent, ...prev].slice(0, 20));

            // Update step status based on event
            updateStepFromEvent(event.topic, event.data);

            // Check for run completion
            if (
              event.topic.endsWith(".completed") &&
              !event.topic.includes(".step.")
            ) {
              setIsRunning(false);
              // Mark all remaining non-completed steps as completed.
              // Memoized steps (sleep, waitForEvent) don't re-publish
              // individual step events when the workflow resumes.
              setSteps((prev) =>
                prev.map((s) =>
                  s.status !== "completed" ? { ...s, status: "completed" as StepStatus } : s
                )
              );
            } else if (
              event.topic.endsWith(".failed") &&
              !event.topic.includes(".step.")
            ) {
              setIsRunning(false);
              setError("Workflow failed");
            }
          },
          onError: (err) => {
            console.error("Subscription error:", err);
          },
        });

        subscriptionRef.current = subscription;
        setIsSubscribed(true);
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
    setApprovalSent(false);

    try {
      // Trigger the actual workflow
      const result = await ironflow.invoke("demo.advanced", {
        data: { source: "steps-demo" },
      });

      if (result.runIds.length > 0) {
        const newRunId = result.runIds[0];
        setRunId(newRunId);

        // Subscribe to events for this run
        await subscribeToRunEvents(newRunId);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to start workflow";
      setError(message);
      setIsRunning(false);
    }
  };

  const sendApproval = async () => {
    if (!runId) {
      setError("No run ID available");
      return;
    }

    try {
      await ironflow.emit("demo.approved", {
        runId,
        approvedAt: new Date().toISOString(),
      });
      setApprovalSent(true);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to send approval";
      setError(message);
    }
  };

  const startSleepUntilDemo = async () => {
    setSleepRunning(true);
    setSleepCompleted(false);
    setSleepRunId(null);
    setSleepEvents([]);

    const targetTime = new Date(Date.now() + sleepOffset * 1000);
    setSleepTargetTime(targetTime);
    setSleepCountdown(sleepOffset);

    try {
      const result = await ironflow.invoke("demo.sleep-until", {
        data: { offsetSeconds: sleepOffset },
      });

      if (result.runIds.length > 0) {
        const newRunId = result.runIds[0];
        setSleepRunId(newRunId);

        // Unsubscribe from previous sleep subscription
        if (sleepSubscriptionRef.current) {
          sleepSubscriptionRef.current.unsubscribe();
        }

        const pattern = `system.run.${newRunId}.>`;
        const subscription = await ironflow.subscribe(pattern, {
          replay: 100,
          onEvent: (event: SubscriptionEvent) => {
            const newEvent: SystemEvent = {
              id: event.eventId || crypto.randomUUID(),
              topic: event.topic,
              type: event.topic.split(".").pop() || "unknown",
              timestamp: new Date(),
              data: event.data,
            };
            setSleepEvents((prev) => [newEvent, ...prev].slice(0, 20));

            // Check for run completion
            if (
              event.topic.endsWith(".completed") &&
              !event.topic.includes(".step.")
            ) {
              setSleepRunning(false);
              setSleepCompleted(true);
            } else if (
              event.topic.endsWith(".failed") &&
              !event.topic.includes(".step.")
            ) {
              setSleepRunning(false);
            }
          },
          onError: (err) => {
            console.error("Sleep subscription error:", err);
          },
        });

        sleepSubscriptionRef.current = subscription;
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to start sleepUntil demo";
      setError(message);
      setSleepRunning(false);
    }
  };

  const hasWaitingStep = steps.some((s) => s.status === "waiting");

  return (
    <div className="container mx-auto py-8 px-4">
      <section className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">
          Step Types Demo
        </h1>
        <p className="text-muted-foreground mb-4">
          Trigger a workflow and watch step execution in real-time via system
          event subscriptions.
        </p>
        <Alert>
          <Radio className="h-4 w-4" />
          <AlertDescription>
            This page subscribes to <code>system.run.{"{runId}"}.&gt;</code> to
            receive real-time step updates directly from the Ironflow server.
          </AlertDescription>
        </Alert>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left Column: Controls & Steps */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Workflow Controls</CardTitle>
              <CardDescription>
                Start a workflow and interact with steps
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-3">
                <Button onClick={startWorkflow} disabled={isRunning}>
                  <Play className="h-4 w-4" />
                  {isRunning ? "Running..." : "Run Workflow"}
                </Button>

                {hasWaitingStep && (
                  <Button onClick={sendApproval} disabled={approvalSent}>
                    <Send className="h-4 w-4" />
                    {approvalSent ? "Approval Sent" : "Send Approval Event"}
                  </Button>
                )}
              </div>

              {runId && (
                <div className="text-sm space-y-1">
                  <div>
                    <span className="text-muted-foreground">Run ID: </span>
                    <code className="bg-muted px-2 py-1 rounded text-xs">
                      {runId}
                    </code>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Subscribed: </span>
                    <Badge variant={isSubscribed ? "default" : "secondary"}>
                      {isSubscribed ? "Yes" : "No"}
                    </Badge>
                  </div>
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
              <CardDescription>
                Steps discovered from real-time events
              </CardDescription>
            </CardHeader>
            <CardContent>
              {steps.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-8">
                  {isRunning
                    ? "Waiting for step events..."
                    : "Run a workflow to see steps appear here."}
                </p>
              ) : (
                <div className="space-y-4">
                  {steps.map((step, index) => (
                    <div key={step.id} className="relative">
                      {/* Connector line */}
                      {index < steps.length - 1 && (
                        <div
                          className={`absolute left-[10px] top-[32px] w-0.5 h-[calc(100%+8px)] ${
                            step.status === "completed"
                              ? "bg-green-500"
                              : "bg-muted"
                          }`}
                        />
                      )}

                      <div className="flex items-start gap-4">
                        {/* Step Icon */}
                        <div className="flex-shrink-0 w-5 h-5 mt-1 z-10 bg-background">
                          {getStepIcon(step.status)}
                        </div>

                        {/* Step Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="font-medium font-mono text-sm">
                              {step.name}
                            </span>
                            <Badge variant={getStatusBadgeVariant(step.status)}>
                              {step.status}
                            </Badge>
                          </div>

                          {/* Step Result */}
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
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              System Events
              <Badge variant="secondary">{systemEvents.length}</Badge>
            </CardTitle>
            <CardDescription>
              Raw events received from the server
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-[600px] overflow-y-auto">
              {systemEvents.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-8">
                  {isRunning
                    ? "Waiting for events..."
                    : "System events will appear here when you run a workflow."}
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
                    <code className="text-xs text-muted-foreground block truncate">
                      {event.topic}
                    </code>
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

      {/* Step Types Reference */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Step Types Reference</CardTitle>
          <CardDescription>
            Common step types in Ironflow workflows
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Badge
                variant="outline"
                className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
              >
                step.run
              </Badge>
              <p className="text-sm text-muted-foreground">
                Execute arbitrary code. Results are memoized for durability.
              </p>
            </div>
            <div className="space-y-2">
              <Badge
                variant="outline"
                className="bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200"
              >
                step.sleep
              </Badge>
              <p className="text-sm text-muted-foreground">
                Pause execution for a duration without consuming resources.
              </p>
            </div>
            <div className="space-y-2">
              <Badge
                variant="outline"
                className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
              >
                step.waitForEvent
              </Badge>
              <p className="text-sm text-muted-foreground">
                Pause until an external event is received.
              </p>
            </div>
            <div className="space-y-2">
              <Badge
                variant="outline"
                className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
              >
                parallel
              </Badge>
              <p className="text-sm text-muted-foreground">
                Execute multiple steps concurrently.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* sleepUntil Demo */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Timer className="h-5 w-5" />
            step.sleepUntil Demo
          </CardTitle>
          <CardDescription>
            Sleep until a specific future time, then continue execution
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Offset Selection */}
          <div className="space-y-3">
            <label className="text-sm font-medium">Select sleep offset</label>
            <div className="flex flex-wrap gap-2">
              {[
                { value: 10, label: "10s" },
                { value: 30, label: "30s" },
                { value: 60, label: "1m" },
              ].map((option) => (
                <Button
                  key={option.value}
                  variant={sleepOffset === option.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSleepOffset(option.value)}
                  disabled={sleepRunning}
                >
                  {option.label} from now
                </Button>
              ))}
            </div>
          </div>

          {/* Run Button */}
          <Button onClick={startSleepUntilDemo} disabled={sleepRunning}>
            <Timer className="h-4 w-4" />
            {sleepRunning ? "Running..." : "Run sleepUntil Demo"}
          </Button>

          {/* Run Info */}
          {sleepRunId && (
            <div className="text-sm space-y-1">
              <div>
                <span className="text-muted-foreground">Run ID: </span>
                <code className="bg-muted px-2 py-1 rounded text-xs">
                  {sleepRunId}
                </code>
              </div>
            </div>
          )}

          {/* Target Time & Countdown */}
          {sleepTargetTime && (
            <div className="rounded-lg border p-4 space-y-3">
              <div className="text-sm">
                <span className="text-muted-foreground">Target time: </span>
                <code className="bg-muted px-2 py-1 rounded text-xs">
                  {sleepTargetTime.toISOString()}
                </code>
              </div>

              {!sleepCompleted && sleepRunning && (
                <div className="flex items-center gap-3">
                  <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">
                        Sleeping until target time...
                      </span>
                      <span className="text-sm tabular-nums font-mono text-muted-foreground">
                        {sleepCountdown}s remaining
                      </span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded-full transition-all duration-1000"
                        style={{
                          width: `${Math.max(0, 100 - (sleepCountdown / sleepOffset) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {sleepCompleted && (
                <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                  <Check className="h-5 w-5" />
                  <span className="text-sm font-medium">
                    sleepUntil completed! Workflow resumed after target time.
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Sleep Demo Events */}
          {sleepEvents.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium flex items-center gap-2">
                Events
                <Badge variant="secondary">{sleepEvents.length}</Badge>
              </h4>
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {sleepEvents.map((event) => (
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
                    <code className="text-xs text-muted-foreground block truncate">
                      {event.topic}
                    </code>
                    {event.data && (
                      <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
                        {JSON.stringify(event.data, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
