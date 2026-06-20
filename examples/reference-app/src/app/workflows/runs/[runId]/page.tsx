"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { ironflow, type Run, type RunStatus } from "@ironflow/browser";
import { ArrowLeft, RefreshCw, XCircle, RotateCcw } from "lucide-react";
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

const statusColors: Record<RunStatus, string> = {
  pending: "bg-yellow-500/10 text-yellow-500",
  running: "bg-blue-500/10 text-blue-500",
  completed: "bg-green-500/10 text-green-500",
  failed: "bg-red-500/10 text-red-500",
  cancelled: "bg-gray-500/10 text-gray-500",
  paused: "bg-purple-500/10 text-purple-500",
  waiting_for_capacity: "bg-yellow-500/10 text-yellow-500",
  waiting: "bg-yellow-500/10 text-yellow-500",
};

function formatDuration(start?: Date, end?: Date): string {
  if (!start) return "-";
  const endTime = end ?? new Date();
  const durationMs = endTime.getTime() - start.getTime();

  if (durationMs < 1000) return `${durationMs}ms`;
  if (durationMs < 60000) return `${(durationMs / 1000).toFixed(1)}s`;
  const minutes = Math.floor(durationMs / 60000);
  const seconds = Math.floor((durationMs % 60000) / 1000);
  if (durationMs < 3600000) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(durationMs / 3600000);
  return `${hours}h ${minutes % 60}m`;
}

export default function RunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = use(params);
  const [run, setRun] = useState<Run | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRun = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await ironflow.getRun(runId);
      setRun(result);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to fetch run";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRun();
  }, [runId]);

  // Auto-refresh for active runs
  useEffect(() => {
    if (!run || run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
      return;
    }
    const interval = setInterval(fetchRun, 2000);
    return () => clearInterval(interval);
  }, [run?.status]);

  return (
    <div className="container mx-auto py-8 px-4">
      <section className="mb-8">
        <div className="flex items-center gap-4 mb-4">
          <Link href="/workflows/runs">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4" />
              Back to Runs
            </Button>
          </Link>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight mb-2">
              Run Details
            </h1>
            <p className="text-muted-foreground font-mono text-sm">{runId}</p>
          </div>
          <Button variant="outline" onClick={fetchRun} disabled={isLoading}>
            <RefreshCw
              className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
      </section>

      <ErrorAlert message={error} className="mb-6" />

      {run && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Overview */}
          <Card>
            <CardHeader>
              <CardTitle>Overview</CardTitle>
              <CardDescription>Run metadata and current state</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Status
                  </p>
                  <Badge
                    variant="secondary"
                    className={statusColors[run.status]}
                  >
                    {run.status}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Function
                  </p>
                  <p className="text-sm font-mono">{run.functionId}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Attempt
                  </p>
                  <p className="text-sm">
                    {run.attempt} / {run.maxAttempts}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Duration
                  </p>
                  <p className="text-sm">
                    {formatDuration(run.startedAt, run.endedAt)}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Created
                  </p>
                  <p className="text-sm">{run.createdAt.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Event ID
                  </p>
                  <code className="text-xs bg-muted px-2 py-1 rounded break-all">
                    {run.eventId}
                  </code>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2 border-t">
                {(run.status === "running" || run.status === "pending") && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={async () => {
                      const reason = window.prompt(
                        "Cancel reason (optional):"
                      );
                      if (reason === null) return;
                      await ironflow.cancelRun(run.id, reason || undefined);
                      fetchRun();
                    }}
                  >
                    <XCircle className="h-4 w-4" />
                    Cancel
                  </Button>
                )}
                {(run.status === "paused" || run.status === "cancelled") && (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={async () => {
                      await ironflow.resumeRun(run.id);
                      fetchRun();
                    }}
                  >
                    <RotateCcw className="h-4 w-4" />
                    Resume
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Input / Output / Error */}
          <Card>
            <CardHeader>
              <CardTitle>Data</CardTitle>
              <CardDescription>Input, output, and error details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {run.input !== undefined && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">
                    Event Data
                  </p>
                  <pre className="text-xs bg-muted p-3 rounded overflow-x-auto max-h-48">
                    {JSON.stringify(run.input, null, 2)}
                  </pre>
                </div>
              )}

              {run.output !== undefined && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">
                    Result
                  </p>
                  <pre className="text-xs bg-muted p-3 rounded overflow-x-auto max-h-48">
                    {JSON.stringify(run.output, null, 2)}
                  </pre>
                </div>
              )}

              {run.error && (
                <div>
                  <p className="text-sm font-medium text-destructive mb-1">
                    Error
                  </p>
                  <div className="bg-destructive/10 text-destructive p-3 rounded">
                    <p className="text-sm font-medium">{run.error.message}</p>
                    {run.error.code && (
                      <p className="text-xs mt-1 opacity-75">
                        Code: {run.error.code}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {run.input === undefined &&
                run.output === undefined &&
                !run.error && (
                  <p className="text-muted-foreground text-sm text-center py-8">
                    No data available yet.
                  </p>
                )}
            </CardContent>
          </Card>
        </div>
      )}

      {!run && !isLoading && !error && (
        <Card>
          <CardContent className="py-12">
            <p className="text-muted-foreground text-center">Run not found.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
