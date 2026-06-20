"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { ironflow, type Subscription, type SubscriptionEvent } from "@ironflow/browser";
import { AlertCircle, ArrowRight, Check, Loader2, Play, RotateCcw, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorAlert } from "@/components/error-alert";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface StepInfo {
  id: string;
  name: string;
  status: string;
  output?: unknown;
  isCompensation?: boolean;
}

const SAGA_STEPS = [
  { id: "reserve-hotel", label: "Hotel", icon: "🏨" },
  { id: "book-flight", label: "Flight", icon: "✈️" },
  { id: "charge-payment", label: "Payment", icon: "💳" },
  { id: "send-confirmation", label: "Confirmation", icon: "📧" },
];

function getStepName(id: string): string {
  const parts = id.split(":");
  return parts.length >= 3 ? parts[parts.length - 2] : id;
}

export default function SagasDemoPage() {
  const [failAtStep, setFailAtStep] = useState("charge-payment");
  const [runId, setRunId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [phase, setPhase] = useState<"idle" | "running" | "failed" | "compensating" | "completed">("idle");
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<StepInfo[]>([]);
  const [events, setEvents] = useState<Array<{ topic: string; timestamp: Date }>>([]);
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
          setEvents((prev) => [{ topic: event.topic, timestamp: new Date() }, ...prev].slice(0, 40));

          const parts = event.topic.split(".");
          if (parts[3] === "step") {
            const stepId = parts[4];
            const eventType = parts[5];
            const dataObj = event.data && typeof event.data === "object" ? (event.data as Record<string, unknown>) : {};
            const stepName = getStepName(stepId);
            const isCompensation = stepName.startsWith("compensate-") || (dataObj.type === "compensate");

            setSteps((prev) => {
              const existing = prev.find((s) => s.id === stepId);
              const newStep: StepInfo = {
                id: stepId,
                name: stepName,
                status: eventType === "completed" ? "completed" : existing?.status || "running",
                output: eventType === "completed" ? (dataObj.output ?? event.data) : existing?.output,
                isCompensation,
              };
              return existing
                ? prev.map((s) => (s.id === stepId ? newStep : s))
                : [...prev, newStep];
            });

            if (isCompensation) {
              setPhase("compensating");
            }
          }

          if (parts.length === 4) {
            if (parts[3] === "failed") {
              setIsRunning(false);
              setPhase("failed");
              setSteps((prev) =>
                prev.map((s) => (s.status === "running" ? { ...s, status: "completed" } : s))
              );
            } else if (parts[3] === "completed") {
              setIsRunning(false);
              setPhase("completed");
              setSteps((prev) =>
                prev.map((s) => (s.status === "running" ? { ...s, status: "completed" } : s))
              );
            }
          }
        },
        onError: (err) => {
          console.error("Subscription error:", err.code, err.message, err);
          setError(`Subscription error: ${err.message || "Unknown"} (${err.code || "?"})`);
        },
      });
      subscriptionRef.current = sub;
    } catch (err) {
      console.error("Subscription failed:", err);
    }
  }, []);

  const triggerSaga = async () => {
    setIsRunning(true);
    setPhase("running");
    setError(null);
    setSteps([]);
    setEvents([]);

    try {
      const result = await ironflow.invoke("demo.saga", {
        data: { failAtStep: failAtStep === "none" ? undefined : failAtStep },
      });
      if (result.runIds.length > 0) {
        const rid = result.runIds[0];
        setRunId(rid);
        await subscribeToRun(rid);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to trigger");
      setPhase("idle");
      setIsRunning(false);
    }
  };

  const reset = () => {
    subscriptionRef.current?.unsubscribe();
    subscriptionRef.current = null;
    setPhase("idle");
    setRunId(null);
    setIsRunning(false);
    setSteps([]);
    setEvents([]);
    setError(null);
  };

  // Determine visual status of each saga step from observed events
  const getStepVisualStatus = (stepId: string) => {
    const forwardStep = steps.find((s) => getStepName(s.id) === stepId && !s.isCompensation);
    const compensationStep = steps.find((s) => getStepName(s.id) === `compensate-${stepId}` || (s.isCompensation && getStepName(s.id).includes(stepId)));

    if (compensationStep) return "compensated";
    if (forwardStep?.status === "completed") return "completed";
    if (forwardStep?.status === "running") return "running";
    if (phase === "failed" || phase === "compensating") {
      // If failure happened before this step, it was skipped
      const failIndex = SAGA_STEPS.findIndex((s) => s.id === failAtStep);
      const thisIndex = SAGA_STEPS.findIndex((s) => s.id === stepId);
      if (thisIndex >= failIndex && failAtStep !== "none") return "skipped";
    }
    return "pending";
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <section className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Saga Compensation</h1>
        <p className="text-muted-foreground mb-4">
          When a multi-step workflow fails, <code>step.compensate()</code> automatically
          runs undo logic in reverse order to clean up completed steps.
        </p>
        <Alert>
          <Undo2 className="h-4 w-4" />
          <AlertDescription>
            Each step registers a compensation handler. If a later step fails, compensations
            run in reverse (last registered first) to roll back side effects.
          </AlertDescription>
        </Alert>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          {/* Controls */}
          <Card>
            <CardHeader>
              <CardTitle>Saga Controls</CardTitle>
              <CardDescription>Choose where to inject a failure</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Fail at step</Label>
                <Select value={failAtStep} onValueChange={setFailAtStep} disabled={phase !== "idle"}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None (succeed)</SelectItem>
                    <SelectItem value="book-flight">book-flight</SelectItem>
                    <SelectItem value="charge-payment">charge-payment</SelectItem>
                    <SelectItem value="send-confirmation">send-confirmation</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex gap-2">
                <Button onClick={triggerSaga} disabled={phase !== "idle"}>
                  <Play className="h-4 w-4" />
                  {isRunning ? "Running..." : "Run Saga"}
                </Button>
                {(phase === "completed" || phase === "failed") && (
                  <Button variant="outline" onClick={reset}>
                    <RotateCcw className="h-4 w-4" />
                    Start Over
                  </Button>
                )}
              </div>

              {runId && (
                <p className="text-xs text-muted-foreground">
                  Run: <code className="bg-muted px-1 rounded">{runId}</code>
                </p>
              )}

              <ErrorAlert message={error} />
            </CardContent>
          </Card>

          {/* Visual Pipeline */}
          <Card>
            <CardHeader>
              <CardTitle>Saga Pipeline</CardTitle>
              <CardDescription>Visual execution flow with compensation on failure</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-1 mb-4">
                {SAGA_STEPS.map((step, index) => {
                  const status = getStepVisualStatus(step.id);
                  return (
                    <div key={step.id} className="flex items-center gap-1 flex-1">
                      <div
                        className={`flex flex-col items-center gap-1 p-3 rounded-lg border flex-1 transition-colors ${
                          status === "completed"
                            ? "border-green-500 bg-green-50 dark:bg-green-950"
                            : status === "compensated"
                              ? "border-amber-500 bg-amber-50 dark:bg-amber-950"
                              : status === "running"
                                ? "border-blue-500 bg-blue-50 dark:bg-blue-950"
                                : status === "skipped"
                                  ? "border-muted bg-muted/30 opacity-50"
                                  : "border-muted"
                        }`}
                      >
                        <span className="text-lg">{step.icon}</span>
                        <span className="text-xs font-medium">{step.label}</span>
                        <Badge
                          variant={
                            status === "completed"
                              ? "default"
                              : status === "compensated"
                                ? "outline"
                                : status === "running"
                                  ? "secondary"
                                  : "secondary"
                          }
                          className={
                            status === "compensated"
                              ? "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
                              : ""
                          }
                        >
                          {status === "compensated" ? "undone" : status}
                        </Badge>
                      </div>
                      {index < SAGA_STEPS.length - 1 && (
                        <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      )}
                    </div>
                  );
                })}
              </div>

              {phase === "completed" && (
                <div className="flex items-center gap-2 text-green-600 dark:text-green-400 mt-2">
                  <Check className="h-4 w-4" />
                  <span className="text-sm font-medium">Saga completed successfully!</span>
                </div>
              )}
              {(phase === "failed" || phase === "compensating") && (
                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 mt-2">
                  <Undo2 className="h-4 w-4" />
                  <span className="text-sm font-medium">
                    {phase === "compensating"
                      ? "Running compensations in reverse order..."
                      : "Saga failed — compensations executed"}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: Step Timeline + Events */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Step Timeline
                <Badge variant="secondary">{steps.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {steps.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Steps will appear here when the saga runs.
                </p>
              ) : (
                <div className="space-y-3">
                  {steps.map((step) => (
                    <div key={step.id} className="flex items-center gap-3 p-3 border rounded-lg">
                      {step.isCompensation ? (
                        <Undo2 className="h-5 w-5 text-amber-500 flex-shrink-0" />
                      ) : step.status === "completed" ? (
                        <Check className="h-5 w-5 text-green-500 flex-shrink-0" />
                      ) : step.status === "running" ? (
                        <Loader2 className="h-5 w-5 text-blue-500 animate-spin flex-shrink-0" />
                      ) : (
                        <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm">{step.name}</span>
                          <Badge
                            variant={
                              step.isCompensation
                                ? "outline"
                                : step.status === "completed"
                                  ? "default"
                                  : "secondary"
                            }
                            className={step.isCompensation ? "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200" : ""}
                          >
                            {step.isCompensation ? "compensation" : step.status}
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

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Events <Badge variant="secondary">{events.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1 max-h-[300px] overflow-y-auto">
                {events.map((evt, i) => (
                  <div key={i} className="text-xs py-1 px-2 bg-muted rounded flex justify-between">
                    <code className="truncate flex-1">{evt.topic}</code>
                    <span className="text-muted-foreground ml-2">{evt.timestamp.toLocaleTimeString()}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Info */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Saga Pattern Reference</CardTitle>
          <CardDescription>How compensation works in Ironflow</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Badge variant="outline" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                Forward Execution
              </Badge>
              <p className="text-sm text-muted-foreground">
                Steps run in order. Each step registers a compensation handler after completing.
              </p>
            </div>
            <div className="space-y-2">
              <Badge variant="outline" className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                step.compensate()
              </Badge>
              <p className="text-sm text-muted-foreground">
                Register undo logic for a previously-run step. Compensations are stored and
                executed only if a later step fails.
              </p>
              <pre className="text-xs bg-muted p-2 rounded">{`step.compensate("reserve-hotel", async () => {\n  // cancel the reservation\n})`}</pre>
            </div>
            <div className="space-y-2">
              <Badge variant="outline" className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                Reverse Compensation
              </Badge>
              <p className="text-sm text-muted-foreground">
                On failure, compensations run in reverse order (last registered first), ensuring
                all side effects are rolled back cleanly.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
