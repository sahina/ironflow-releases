"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  ironflow,
  type Subscription,
  type ProjectionStatusInfo,
} from "@ironflow/browser";
import { useIronflow } from "@/components/ironflow-provider";
import { RefreshCw, Radio, WifiOff, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ErrorAlert } from "@/components/error-alert";

const PROJECTION_NAME = "bank-account-balance";

interface BalanceState {
  balance: number;
  transactionCount: number;
  lastTransaction: string;
}

function statusColor(status: string): string {
  switch (status) {
    case "active":
      return "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20";
    case "rebuilding":
      return "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20";
    case "paused":
      return "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20";
    case "error":
      return "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20";
    default:
      return "";
  }
}

export default function ProjectionsPage() {
  const { isConnected } = useIronflow();

  // Projection state
  const [balanceState, setBalanceState] = useState<BalanceState | null>(null);
  const [stateVersion, setStateVersion] = useState<number | null>(null);
  const [stateLoading, setStateLoading] = useState(false);
  const [stateError, setStateError] = useState<string | null>(null);

  // Live subscription
  const [isSubscribed, setIsSubscribed] = useState(false);
  const subscriptionRef = useRef<Subscription | null>(null);

  // Projection status
  const [projectionStatus, setProjectionStatus] =
    useState<ProjectionStatusInfo | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  // All projections
  const [allProjections, setAllProjections] = useState<
    ProjectionStatusInfo[]
  >([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // Rebuild
  const [rebuilding, setRebuilding] = useState(false);

  const fetchState = useCallback(async () => {
    setStateError(null);

    if (!ironflow.isConfigured) {
      setStateError("Client not configured. Please wait for connection.");
      return;
    }

    setStateLoading(true);
    try {
      const result = await ironflow.getProjection<BalanceState>(
        PROJECTION_NAME
      );
      const s = result.state;
      setBalanceState({
        balance: s.balance ?? 0,
        transactionCount: s.transactionCount ?? 0,
        lastTransaction: s.lastTransaction ?? "",
      });
      setStateVersion(result.version);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to fetch projection state";
      // 404 means projection doesn't exist yet — not an error worth displaying
      if (!message.includes("404")) {
        setStateError(message);
      }
    } finally {
      setStateLoading(false);
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    setStatusError(null);

    if (!ironflow.isConfigured) {
      setStatusError("Client not configured. Please wait for connection.");
      return;
    }

    setStatusLoading(true);
    try {
      const status = await ironflow.getProjectionStatus(PROJECTION_NAME);
      setProjectionStatus(status);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to fetch projection status";
      // 404 means projection doesn't exist yet — not an error worth displaying
      if (!message.includes("404")) {
        setStatusError(message);
      }
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const fetchAllProjections = useCallback(async () => {
    setListError(null);

    if (!ironflow.isConfigured) {
      setListError("Client not configured. Please wait for connection.");
      return;
    }

    setListLoading(true);
    try {
      const projections = await ironflow.listProjections();
      setAllProjections(projections);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to list projections";
      setListError(message);
    } finally {
      setListLoading(false);
    }
  }, []);

  const toggleSubscription = async () => {
    if (isSubscribed) {
      // Unsubscribe
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe();
        subscriptionRef.current = null;
      }
      setIsSubscribed(false);
      return;
    }

    // Subscribe
    setStateError(null);

    if (!ironflow.isConfigured) {
      setStateError("Client not configured. Please wait for connection.");
      return;
    }

    try {
      const subscription = await ironflow.subscribeToProjection<BalanceState>(
        PROJECTION_NAME,
        {
          onUpdate: (state) => {
            setBalanceState({
              balance: state.balance ?? 0,
              transactionCount: state.transactionCount ?? 0,
              lastTransaction: state.lastTransaction ?? "",
            });
            setStateVersion(null);
          },
          onError: (err) => {
            setStateError(err.message);
          },
        }
      );

      subscriptionRef.current = subscription;
      setIsSubscribed(true);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to subscribe";
      setStateError(message);
    }
  };

  const handleRebuild = async () => {
    setStatusError(null);

    if (!ironflow.isConfigured) {
      setStatusError("Client not configured. Please wait for connection.");
      return;
    }

    setRebuilding(true);
    try {
      await ironflow.rebuildProjection(PROJECTION_NAME);
      // Re-fetch status and state after rebuild
      await Promise.all([fetchStatus(), fetchState()]);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to rebuild projection";
      // 404 means projection doesn't exist yet — not an error worth displaying
      if (!message.includes("404")) {
        setStatusError(message);
      }
    } finally {
      setRebuilding(false);
    }
  };

  // Fetch when connected, cleanup subscription on unmount
  useEffect(() => {
    if (!isConnected) return;

    fetchState();
    fetchStatus();
    fetchAllProjections();

    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe();
        subscriptionRef.current = null;
      }
    };
  }, [isConnected, fetchState, fetchStatus, fetchAllProjections]);

  return (
    <div className="container mx-auto py-8 px-4">
      <section className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Projections</h1>
        <p className="text-muted-foreground">
          View projection state built from event streams. Projections are
          read models that automatically update as new events are appended.
        </p>
      </section>

      {/* Top section: Projection State (full width) */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Projection State</CardTitle>
              <CardDescription>
                Current state of the{" "}
                <code className="font-mono">{PROJECTION_NAME}</code> projection
                {stateVersion !== null && (
                  <span className="ml-2 text-xs">(v{stateVersion})</span>
                )}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant={isSubscribed ? "destructive" : "outline"}
                size="sm"
                onClick={toggleSubscription}
              >
                {isSubscribed ? (
                  <>
                    <WifiOff className="h-4 w-4" />
                    Stop Live
                  </>
                ) : (
                  <>
                    <Radio className="h-4 w-4" />
                    Live Updates
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={fetchState}
                disabled={stateLoading}
              >
                <RefreshCw
                  className={`h-4 w-4 ${stateLoading ? "animate-spin" : ""}`}
                />
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ErrorAlert message={stateError} />

          {isSubscribed && (
            <div className="flex items-center gap-2 p-3 bg-muted rounded-md mb-4">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
              </span>
              <span className="text-sm text-muted-foreground">
                Receiving live updates
              </span>
            </div>
          )}

          {balanceState ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="border rounded-lg p-4 text-center">
                <p className="text-sm text-muted-foreground mb-1">Balance</p>
                <p className="text-3xl font-bold">
                  ${balanceState.balance.toFixed(2)}
                </p>
              </div>
              <div className="border rounded-lg p-4 text-center">
                <p className="text-sm text-muted-foreground mb-1">
                  Transactions
                </p>
                <p className="text-3xl font-bold">
                  {balanceState.transactionCount}
                </p>
              </div>
              <div className="border rounded-lg p-4 text-center">
                <p className="text-sm text-muted-foreground mb-1">
                  Last Transaction
                </p>
                <p className="text-xl font-mono">
                  {balanceState.lastTransaction}
                </p>
              </div>
            </div>
          ) : (
            !stateError && (
              <p className="text-muted-foreground text-sm text-center py-8">
                No projection state available. Is the worker running?
              </p>
            )
          )}
        </CardContent>
      </Card>

      {/* Bottom section: two-column grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: Projection Status */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Projection Status</CardTitle>
                <CardDescription>
                  Health and processing status of the projection
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={fetchStatus}
                disabled={statusLoading}
              >
                <RefreshCw
                  className={`h-4 w-4 ${statusLoading ? "animate-spin" : ""}`}
                />
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <ErrorAlert message={statusError} />

            {projectionStatus ? (
              <>
                <div className="bg-muted rounded-md p-3 space-y-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Status</span>
                    <Badge className={statusColor(projectionStatus.status)}>
                      {projectionStatus.status}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Mode</span>
                    <Badge variant="outline">{projectionStatus.mode}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Lag</span>
                    <span className="font-mono">{projectionStatus.lag}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      Last Event Seq
                    </span>
                    <span className="font-mono">
                      {projectionStatus.lastEventSeq}
                    </span>
                  </div>
                  {projectionStatus.updatedAt && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Updated At</span>
                      <span className="text-xs">
                        {new Date(projectionStatus.updatedAt).toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>

                {projectionStatus.errorMessage && (
                  <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                    <span className="font-medium">Error:</span>{" "}
                    {projectionStatus.errorMessage}
                  </div>
                )}
              </>
            ) : (
              !statusError && (
                <p className="text-muted-foreground text-sm text-center py-4">
                  No status available.
                </p>
              )
            )}

            <Button
              onClick={handleRebuild}
              disabled={rebuilding || !projectionStatus}
              variant="outline"
              className="w-full"
            >
              {rebuilding ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Rebuilding...
                </>
              ) : (
                <>
                  <RotateCcw className="h-4 w-4" />
                  Rebuild Projection
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Right: All Projections */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>All Projections</CardTitle>
                <CardDescription>
                  All registered projections in the system
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={fetchAllProjections}
                disabled={listLoading}
              >
                <RefreshCw
                  className={`h-4 w-4 ${listLoading ? "animate-spin" : ""}`}
                />
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <ErrorAlert message={listError} />

            {allProjections.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Mode</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allProjections.map((projection) => (
                    <TableRow key={projection.name}>
                      <TableCell className="font-mono">
                        {projection.name}
                      </TableCell>
                      <TableCell>
                        <Badge className={statusColor(projection.status)}>
                          {projection.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{projection.mode}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              !listError && (
                <p className="text-muted-foreground text-sm text-center py-8">
                  No projections registered. Is the worker running?
                </p>
              )
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
