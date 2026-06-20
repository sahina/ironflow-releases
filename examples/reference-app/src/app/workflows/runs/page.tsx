"use client";

import { useState, useEffect } from "react";
import { ironflow, Run, RunStatus } from "@ironflow/browser";
import { RefreshCw, XCircle, RotateCcw } from "lucide-react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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

  if (durationMs < 1000) {
    return `${durationMs}ms`;
  } else if (durationMs < 60000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  } else if (durationMs < 3600000) {
    const minutes = Math.floor(durationMs / 60000);
    const seconds = Math.floor((durationMs % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  } else {
    const hours = Math.floor(durationMs / 3600000);
    const minutes = Math.floor((durationMs % 3600000) / 60000);
    return `${hours}h ${minutes}m`;
  }
}

export default function RunsHistoryPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);

  const fetchRuns = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await ironflow.listRuns({ limit: 20 });
      setRuns(result.runs);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to fetch runs";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRuns();
  }, []);

  return (
    <div className="container mx-auto py-8 px-4">
      <section className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight mb-2">
              Run History
            </h1>
            <p className="text-muted-foreground">
              View and inspect workflow run history.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={fetchRuns}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </section>

      <ErrorAlert message={error} className="mb-6" />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column: Runs Table (2 cols on lg) */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent Runs</CardTitle>
            <CardDescription>
              {runs.length} run{runs.length !== 1 ? "s" : ""} loaded
            </CardDescription>
          </CardHeader>
          <CardContent>
            {runs.length === 0 && !isLoading ? (
              <p className="text-muted-foreground text-sm text-center py-8">
                No runs found. Trigger a workflow to see runs here.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Run ID</TableHead>
                    <TableHead>Function</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => (
                    <TableRow
                      key={run.id}
                      className={`cursor-pointer ${
                        selectedRun?.id === run.id ? "bg-muted" : ""
                      }`}
                      onClick={() => setSelectedRun(run)}
                    >
                      <TableCell className="font-mono text-xs">
                        {run.id.length > 12
                          ? `${run.id.slice(0, 8)}...${run.id.slice(-4)}`
                          : run.id}
                      </TableCell>
                      <TableCell>{run.functionId}</TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={statusColors[run.status]}
                        >
                          {run.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {formatDuration(run.startedAt, run.endedAt)}
                      </TableCell>
                      <TableCell>
                        {run.startedAt
                          ? run.startedAt.toLocaleString()
                          : run.createdAt.toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                          {(run.status === "running" || run.status === "pending") && (
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Cancel run"
                              onClick={async () => {
                                const reason = window.prompt("Cancel reason (optional):");
                                if (reason === null) return;
                                await ironflow.cancelRun(run.id, reason || undefined);
                                fetchRuns();
                              }}
                            >
                              <XCircle className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                          {(run.status === "paused" || run.status === "cancelled") && (
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Resume run"
                              onClick={async () => {
                                await ironflow.resumeRun(run.id);
                                fetchRuns();
                              }}
                            >
                              <RotateCcw className="h-4 w-4 text-blue-500" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Right Column: Run Details (1 col on lg) */}
        <Card>
          <CardHeader>
            <CardTitle>Run Details</CardTitle>
            <CardDescription>
              {selectedRun
                ? `Details for run ${selectedRun.id.slice(0, 8)}...`
                : "Select a run to view details"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {selectedRun ? (
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Run ID
                  </p>
                  <code className="text-xs bg-muted px-2 py-1 rounded break-all">
                    {selectedRun.id}
                  </code>
                </div>

                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Function ID
                  </p>
                  <p className="text-sm">{selectedRun.functionId}</p>
                </div>

                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Status
                  </p>
                  <Badge
                    variant="secondary"
                    className={statusColors[selectedRun.status]}
                  >
                    {selectedRun.status}
                  </Badge>
                </div>

                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Attempt
                  </p>
                  <p className="text-sm">
                    {selectedRun.attempt} / {selectedRun.maxAttempts}
                  </p>
                </div>

                {selectedRun.input !== undefined && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Event Data
                    </p>
                    <pre className="text-xs bg-muted p-2 rounded overflow-x-auto max-h-40">
                      {JSON.stringify(selectedRun.input, null, 2)}
                    </pre>
                  </div>
                )}

                {selectedRun.output !== undefined && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Result
                    </p>
                    <pre className="text-xs bg-muted p-2 rounded overflow-x-auto max-h-40">
                      {JSON.stringify(selectedRun.output, null, 2)}
                    </pre>
                  </div>
                )}

                {selectedRun.error && (
                  <div>
                    <p className="text-sm font-medium text-destructive">
                      Error
                    </p>
                    <div className="text-xs bg-destructive/10 text-destructive p-2 rounded">
                      <p className="font-medium">{selectedRun.error.message}</p>
                      {selectedRun.error.code && (
                        <p className="text-muted-foreground">
                          Code: {selectedRun.error.code}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Duration
                  </p>
                  <p className="text-sm">
                    {formatDuration(selectedRun.startedAt, selectedRun.endedAt)}
                  </p>
                </div>

                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Created At
                  </p>
                  <p className="text-sm">
                    {selectedRun.createdAt.toLocaleString()}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm text-center py-8">
                Click on a run in the table to view its details.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
