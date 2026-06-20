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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Clock, Play, Square, Trash2 } from "lucide-react";

const INTERVALS = {
  "1m":  { functionId: "cron-reporter-1m",  cron: "* * * * *",      seconds: 60,  label: "Every 1 minute" },
  "2m":  { functionId: "cron-reporter-2m",  cron: "*/2 * * * *",    seconds: 120, label: "Every 2 minutes" },
  "5m":  { functionId: "cron-reporter-5m",  cron: "*/5 * * * *",    seconds: 300, label: "Every 5 minutes" },
} as const;

type IntervalKey = keyof typeof INTERVALS;

interface CronRun {
  id: string;
  status: string;
  startedAt: Date;
  output?: unknown;
}

export default function CronPage() {
  const [interval, setInterval_] = useState<IntervalKey>("1m");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [runs, setRuns] = useState<CronRun[]>([]);
  const [nextFire, setNextFire] = useState<string | null>(null);
  const subscriptionRef = useRef<Subscription | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const intervalRef = useRef<IntervalKey>("1m");

  // Keep ref in sync so the subscription callback sees the latest value
  useEffect(() => {
    intervalRef.current = interval;
  }, [interval]);

  useEffect(() => {
    return () => {
      subscriptionRef.current?.unsubscribe();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Countdown timer for next cron fire
  useEffect(() => {
    if (!isSubscribed) return;

    const secs = INTERVALS[interval].seconds;
    const updateCountdown = () => {
      const now = new Date();
      const remaining = secs - (now.getSeconds() % secs);
      setNextFire(`${remaining}s`);
    };

    updateCountdown();
    timerRef.current = globalThis.setInterval(updateCountdown, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isSubscribed, interval]);

  const startListening = useCallback(async () => {
    if (!ironflow.isConfigured) return;

    try {
      const sub = await ironflow.subscribe("system.run.>", {
        onEvent: (event: SubscriptionEvent) => {
          const parts = event.topic.split(".");
          if (parts.length !== 4 || parts[0] !== "system" || parts[1] !== "run") return;

          const data = event.data as { functionId?: string; id?: string; status?: string; output?: unknown; startedAt?: string };
          if (data.functionId !== INTERVALS[intervalRef.current].functionId) return;

          const eventType = parts[3];

          if (eventType === "updated" && data.status === "running" && data.id) {
            setRuns((prev) => {
              if (prev.some((r) => r.id === data.id)) return prev;
              return [{
                id: data.id!,
                status: "running",
                startedAt: data.startedAt ? new Date(data.startedAt) : new Date(),
              }, ...prev].slice(0, 20);
            });
          } else if (eventType === "completed" && data.id) {
            setRuns((prev) => {
              const exists = prev.some((r) => r.id === data.id);
              if (exists) {
                return prev.map((r) =>
                  r.id === data.id ? { ...r, status: "completed", output: data.output } : r
                );
              }
              return [{
                id: data.id!,
                status: "completed",
                startedAt: data.startedAt ? new Date(data.startedAt) : new Date(),
                output: data.output,
              }, ...prev].slice(0, 20);
            });
          }
        },
      });

      subscriptionRef.current = sub;
      setIsSubscribed(true);
    } catch (err) {
      console.error("Failed to subscribe:", err);
    }
  }, []);

  const stopListening = () => {
    subscriptionRef.current?.unsubscribe();
    subscriptionRef.current = null;
    setIsSubscribed(false);
  };

  const config = INTERVALS[interval];

  return (
    <div className="container mx-auto py-8 px-4">
      <section className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Cron Triggers</h1>
        <p className="text-muted-foreground mb-4">
          Watch cron-triggered workflows execute on a schedule. Select a firing interval below and start listening.
        </p>
        <Alert>
          <Clock className="h-4 w-4" />
          <AlertDescription>
            Current cron expression: <code>{config.cron}</code> — {config.label.toLowerCase()}.
          </AlertDescription>
        </Alert>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Controls</CardTitle>
            <CardDescription>Choose a firing interval and start listening</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Firing interval</label>
              <Select
                value={interval}
                onValueChange={(v) => setInterval_(v as IntervalKey)}
                disabled={isSubscribed}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1m">Every 1 minute</SelectItem>
                  <SelectItem value="2m">Every 2 minutes</SelectItem>
                  <SelectItem value="5m">Every 5 minutes</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              {!isSubscribed ? (
                <Button onClick={startListening}>
                  <Play className="h-4 w-4" />
                  Start Listening
                </Button>
              ) : (
                <Button onClick={stopListening} variant="secondary">
                  <Square className="h-4 w-4" />
                  Stop Listening
                </Button>
              )}
              {runs.length > 0 && (
                <Button variant="outline" onClick={() => setRuns([])}>
                  <Trash2 className="h-4 w-4" />
                  Clear
                </Button>
              )}
            </div>
            <div className="text-sm space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status:</span>
                <Badge variant={isSubscribed ? "default" : "secondary"}>
                  {isSubscribed ? "Listening" : "Idle"}
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Function:</span>
                <code className="text-xs">{config.functionId}</code>
              </div>
              {nextFire && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Next fire:</span>
                  <span className="font-mono">{nextFire}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total runs:</span>
                <span className="font-mono">{runs.length}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Cron Run History <Badge variant="secondary">{runs.length}</Badge>
            </CardTitle>
            <CardDescription>Recent cron-triggered runs for <code>{config.functionId}</code></CardDescription>
          </CardHeader>
          <CardContent>
            {runs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">
                {isSubscribed
                  ? "Waiting for cron trigger..."
                  : "Start listening to see cron runs appear here."}
              </p>
            ) : (
              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {runs.map((run) => (
                  <div
                    key={run.id}
                    className="border rounded-lg p-3 space-y-2 animate-in fade-in slide-in-from-top-2"
                  >
                    <div className="flex items-center justify-between">
                      <code className="text-xs">{run.id}</code>
                      <div className="flex items-center gap-2">
                        <Badge variant={run.status === "completed" ? "default" : "secondary"}>
                          {run.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {run.startedAt.toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                    {run.output != null && (
                      <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
                        {JSON.stringify(run.output, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
