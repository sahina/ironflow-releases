"use client";

import { useEffect, useState, useRef, useCallback } from "react";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ErrorAlert } from "@/components/error-alert";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { AlertCircle, Check, Loader2, Play, Wrench, RotateCcw } from "lucide-react";

interface StepInfo {
  id: string;
  status: string;
  output?: unknown;
  error?: unknown;
}

type WorkflowPhase = "idle" | "running" | "failed" | "patching" | "resuming" | "completed";

// Extract human-readable step name from full step ID like "runId:step-name:0"
function getStepName(id: string): string {
  const parts = id.split(":");
  return parts.length >= 3 ? parts[parts.length - 2] : id;
}

export default function HotPatchPage() {
  const [phase, setPhase] = useState<WorkflowPhase>("idle");
  const [runId, setRunId] = useState<string | null>(null);
  const [failAtStep, setFailAtStep] = useState("process-data");
  const [steps, setSteps] = useState<StepInfo[]>([]);
  // detectedFailedStep is now derived via useMemo (detectedFailedStep) below
  const [patchOutput, setPatchOutput] = useState('{"processed": true, "patched": true}');
  const [patchReason, setPatchReason] = useState("Manual fix via demo");
  const [events, setEvents] = useState<Array<{ topic: string; timestamp: Date }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [patched, setPatched] = useState(false);
  const [resumed, setResumed] = useState(false);
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
          setEvents((prev) => [{ topic: event.topic, timestamp: new Date() }, ...prev].slice(0, 30));

          const parts = event.topic.split(".");
          if (parts[3] === "step") {
            const stepId = parts[4];
            const eventType = parts[5];
            setSteps((prev) => {
              const existing = prev.find((s) => s.id === stepId);
              const newStep: StepInfo = {
                id: stepId,
                status: eventType === "completed" ? "completed" : eventType === "created" ? "running" : existing?.status || "pending",
                output: eventType === "completed" ? event.data : existing?.output,
                error: eventType === "patched" ? undefined : existing?.error,
              };
              if (eventType === "patched") {
                newStep.status = "completed";
                const patchData = event.data as Record<string, unknown> | undefined;
                newStep.output = patchData?.output ?? event.data;
              }
              return existing
                ? prev.map((s) => (s.id === stepId ? newStep : s))
                : [...prev, newStep];
            });
          }

          // Run-level events
          if (parts.length === 4) {
            const eventType = parts[3];
            if (eventType === "failed") {
              setPhase("failed");
              setResumed(false);
              setPatched(false);
            } else if (eventType === "completed") {
              setPhase("completed");
              // Mark any remaining "running" steps as completed
              setSteps((prev) =>
                prev.map((s) =>
                  s.status === "running" ? { ...s, status: "completed" } : s
                )
              );
            }
          }
        },
      });
      subscriptionRef.current = sub;
    } catch (err) {
      console.error("Subscription failed:", err);
    }
  }, []);

  const triggerWorkflow = async () => {
    setPhase("running");
    setError(null);
    setSteps([]);
    setEvents([]);

    try {
      const result = await ironflow.invoke("demo.hot-patch", {
        data: { failAtStep },
      });
      if (result.runIds.length > 0) {
        const rid = result.runIds[0];
        setRunId(rid);
        await subscribeToRun(rid);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to trigger");
      setPhase("idle");
    }
  };

  const patchStep = async () => {
    if (!detectedFailedStep) return;
    setPhase("patching");
    try {
      const output = JSON.parse(patchOutput);
      await ironflow.patchStep(detectedFailedStep.id, output, patchReason);
      setPatched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Patch failed");
      setPhase("failed");
    }
  };

  const resumeRun = async () => {
    if (!runId) return;
    setPhase("resuming");
    setResumed(true);
    try {
      await ironflow.resumeRun(runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Resume failed");
      setPhase("failed");
      setResumed(false);
    }
  };

  const resetAll = () => {
    subscriptionRef.current?.unsubscribe();
    subscriptionRef.current = null;
    setPhase("idle");
    setRunId(null);
    setSteps([]);
    setEvents([]);
    setError(null);
    setPatched(false);
    setResumed(false);
  };

  // Detect failed step — pick the LAST "running" step since the server only
  // publishes "created" events (no per-step "completed"), so all steps appear
  // as "running". The last one created before the run failed is the culprit.
  // Derived as a plain computation instead of useEffect+setState to avoid cascading renders.
  const detectedFailedStep = phase === "failed"
    ? (steps.filter((s) => s.status === "running").at(-1) ?? null)
    : null;

  return (
    <div className="container mx-auto py-8 px-4">
      <section className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Hot Patching</h1>
        <p className="text-muted-foreground mb-4">
          Trigger a workflow with an injected failure, then patch the failed step&apos;s output and resume execution.
        </p>
        <Alert>
          <Wrench className="h-4 w-4" />
          <AlertDescription>
            Hot patching allows you to manually fix a failed step&apos;s output without restarting the entire workflow.
          </AlertDescription>
        </Alert>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          {/* Step 1: Trigger */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Badge variant={phase !== "idle" && phase !== "running" ? "default" : "outline"}>
                  {phase !== "idle" && phase !== "running" ? <Check className="h-3 w-3" /> : "1"}
                </Badge>
                Trigger Workflow
              </CardTitle>
              <CardDescription>Choose which step to inject a failure at</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Fail at step</Label>
                <Select value={failAtStep} onValueChange={setFailAtStep} disabled={phase !== "idle"}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="process-data">process-data</SelectItem>
                    <SelectItem value="store-result">store-result</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button onClick={triggerWorkflow} disabled={phase !== "idle"}>
                  <Play className="h-4 w-4" />
                  {phase === "running" ? "Running..." : "Trigger hot-patch-demo"}
                </Button>
                {phase === "completed" && (
                  <Button variant="outline" onClick={resetAll}>
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
            </CardContent>
          </Card>

          {/* Step 2: Patch */}
          <Card className={phase === "failed" ? "ring-2 ring-destructive" : ""}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Badge variant={patched ? "default" : "outline"}>
                  {patched ? <Check className="h-3 w-3" /> : "2"}
                </Badge>
                Patch Failed Step
              </CardTitle>
              <CardDescription>Fix the output of the failed step</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {detectedFailedStep ? (
                <>
                  <div>
                    <Label>Failed step: <code>{getStepName(detectedFailedStep.id)}</code></Label>
                  </div>
                  <div>
                    <Label>New output (JSON)</Label>
                    <Textarea
                      value={patchOutput}
                      onChange={(e) => setPatchOutput(e.target.value)}
                      className="mt-1 font-mono text-sm"
                      rows={3}
                    />
                  </div>
                  <div>
                    <Label>Reason</Label>
                    <Input
                      value={patchReason}
                      onChange={(e) => setPatchReason(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <Button onClick={patchStep} disabled={phase !== "failed"}>
                    <Wrench className="h-4 w-4" />
                    Patch Output
                  </Button>
                </>
              ) : (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Waiting for a step to fail...
                </p>
              )}
            </CardContent>
          </Card>

          {/* Step 3: Resume */}
          <Card className={phase === "completed" ? "border-t-4 border-t-green-500" : ""}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Badge variant={phase === "completed" ? "default" : "outline"}>
                  {phase === "completed" ? <Check className="h-3 w-3" /> : "3"}
                </Badge>
                Resume Run
              </CardTitle>
              <CardDescription>Continue execution after patching</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={resumeRun} disabled={!patched || resumed}>
                <RotateCcw className="h-4 w-4" />
                {phase === "resuming" ? "Resuming..." : "Resume Run"}
              </Button>
              {phase === "completed" && (
                <div className="mt-3 flex items-center gap-2 text-green-600">
                  <Check className="h-4 w-4" />
                  <span className="text-sm font-medium">Workflow completed successfully!</span>
                </div>
              )}
            </CardContent>
          </Card>

          <ErrorAlert message={error} />
        </div>

        {/* Right: Step Timeline + Events */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Step Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              {steps.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Steps will appear here when the workflow runs.
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
                        <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm">{getStepName(step.id)}</span>
                          <Badge variant={step.status === "completed" ? "default" : step.status === "running" ? "secondary" : "destructive"}>
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
    </div>
  );
}
