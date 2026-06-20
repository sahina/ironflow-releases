"use client";

import { useState } from "react";
import Link from "next/link";
import { ironflow } from "@ironflow/browser";
import { ArrowRight, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ErrorAlert } from "@/components/error-alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const workflows = [
  {
    id: "simple-workflow",
    name: "Simple Workflow",
    description: "A basic workflow with a single step",
    event: "demo.simple",
  },
  {
    id: "advanced-workflow",
    name: "Advanced Workflow",
    description: "Demonstrates sleep, waitForEvent, and parallel steps",
    event: "demo.advanced",
  },
];

interface TriggerResultItem {
  id: string;
  runId: string;
  functionId: string;
  timestamp: Date;
  sync: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result?: any;
}

const DEFAULT_PAYLOAD = JSON.stringify(
  {
    message: "Hello from trigger demo",
    timestamp: new Date().toISOString(),
  },
  null,
  2
);

export default function TriggerWorkflowsPage() {
  const [selectedWorkflow, setSelectedWorkflow] = useState(workflows[0].id);
  const [payload, setPayload] = useState(DEFAULT_PAYLOAD);
  const [syncMode, setSyncMode] = useState(false);
  const [isTriggering, setIsTriggering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<TriggerResultItem[]>([]);

  const selectedWorkflowData = workflows.find((w) => w.id === selectedWorkflow);

  const handleTrigger = async () => {
    setIsTriggering(true);
    setError(null);

    try {
      const parsedPayload = JSON.parse(payload);
      const workflow = workflows.find((w) => w.id === selectedWorkflow);

      if (!workflow) {
        throw new Error("Workflow not found");
      }

      const triggerResult = await ironflow.invoke(workflow.event, {
        data: parsedPayload,
      });

      let result: unknown = undefined;

      if (syncMode && triggerResult.runIds.length > 0) {
        // Poll for completion in sync mode
        const runId = triggerResult.runIds[0];
        const maxAttempts = 30;
        const pollInterval = 1000;

        for (let i = 0; i < maxAttempts; i++) {
          const run = await ironflow.getRun(runId);
          if (run.status === "completed") {
            result = run.output;
            break;
          } else if (run.status === "failed" || run.status === "cancelled") {
            result = { error: run.error?.message || "Run failed" };
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, pollInterval));
        }
      }

      const newResults: TriggerResultItem[] = triggerResult.runIds.map(
        (runId) => ({
          id: crypto.randomUUID(),
          runId,
          functionId: workflow.id,
          timestamp: new Date(),
          sync: syncMode,
          result,
        })
      );

      setResults((prev) => [...newResults, ...prev]);
    } catch (err) {
      if (err instanceof SyntaxError) {
        setError("Invalid JSON payload: " + err.message);
      } else {
        const message =
          err instanceof Error ? err.message : "Failed to trigger workflow";
        setError(message);
      }
    } finally {
      setIsTriggering(false);
    }
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <section className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">
          Trigger Workflows
        </h1>
        <p className="text-muted-foreground">
          Trigger durable workflows and track their execution in real-time.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left Column: Configuration */}
        <Card>
          <CardHeader>
            <CardTitle>Trigger Configuration</CardTitle>
            <CardDescription>
              Select a workflow and configure the trigger payload
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Workflow Selection */}
            <div className="space-y-2">
              <Label htmlFor="workflow">Workflow</Label>
              <Select
                value={selectedWorkflow}
                onValueChange={setSelectedWorkflow}
              >
                <SelectTrigger id="workflow" className="w-full">
                  <SelectValue placeholder="Select a workflow" />
                </SelectTrigger>
                <SelectContent>
                  {workflows.map((workflow) => (
                    <SelectItem key={workflow.id} value={workflow.id}>
                      {workflow.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedWorkflowData && (
                <p className="text-sm text-muted-foreground">
                  {selectedWorkflowData.description}
                </p>
              )}
            </div>

            {/* Payload */}
            <div className="space-y-2">
              <Label htmlFor="payload">JSON Payload</Label>
              <Textarea
                id="payload"
                value={payload}
                onChange={(e) => setPayload(e.target.value)}
                className="font-mono text-sm min-h-[150px]"
                placeholder='{"key": "value"}'
              />
            </div>

            {/* Sync Mode */}
            <div className="flex items-center space-x-2">
              <Checkbox
                id="syncMode"
                checked={syncMode}
                onCheckedChange={(checked) => setSyncMode(checked === true)}
              />
              <Label htmlFor="syncMode" className="cursor-pointer">
                Sync mode (wait for completion)
              </Label>
            </div>

            {/* Error Display */}
            <ErrorAlert message={error} />

            {/* Trigger Button */}
            <Button
              onClick={handleTrigger}
              disabled={isTriggering}
              className="w-full"
            >
              <Play className="h-4 w-4" />
              {isTriggering
                ? syncMode
                  ? "Triggering & waiting..."
                  : "Triggering..."
                : "Trigger Workflow"}
            </Button>
          </CardContent>
        </Card>

        {/* Right Column: Results */}
        <Card>
          <CardHeader>
            <CardTitle>Trigger Results</CardTitle>
            <CardDescription>
              {results.length} workflow{results.length !== 1 ? "s" : ""}{" "}
              triggered
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-[500px] overflow-y-auto">
              {results.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-8">
                  No workflows triggered yet. Use the form to trigger your first
                  workflow.
                </p>
              ) : (
                results.map((item) => (
                  <div
                    key={item.id}
                    className="border rounded-lg p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{item.functionId}</Badge>
                        {item.sync && <Badge variant="outline">sync</Badge>}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {item.timestamp.toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <code className="text-xs bg-muted px-2 py-1 rounded">
                        {item.runId}
                      </code>
                      <Link href={`/workflows/runs/${item.runId}`}>
                        <Button variant="ghost" size="sm">
                          View Run
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      </Link>
                    </div>
                    {item.result && (
                      <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
                        {JSON.stringify(item.result, null, 2)}
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
  );
}
