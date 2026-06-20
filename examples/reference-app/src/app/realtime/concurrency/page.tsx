"use client";

import { useEffect, useState, useRef } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Layers, Play, User, Loader2, Check } from "lucide-react";

interface LaneRun {
  id: string;
  customerId: string;
  status: "queued" | "running" | "completed";
  startedAt: Date;
}

interface ActorRun {
  id: string;
  userId: string;
  status: "running" | "completed";
  workerId?: string;
  startedAt: Date;
}

export default function ConcurrencyPage() {
  // Concurrency lane state
  const [laneRuns, setLaneRuns] = useState<LaneRun[]>([]);
  const [laneCustomerId, setLaneCustomerId] = useState("customer-A");
  const [laneCount, setLaneCount] = useState(4);
  const [laneEmitting, setLaneEmitting] = useState(false);

  // Actor routing state
  const [actorRuns, setActorRuns] = useState<ActorRun[]>([]);
  const [actorUserId, setActorUserId] = useState("user-123");
  const [actorCount, setActorCount] = useState(3);
  const [actorEmitting, setActorEmitting] = useState(false);

  const laneSubRef = useRef<Subscription | null>(null);
  const actorSubRef = useRef<Subscription | null>(null);

  useEffect(() => {
    return () => {
      laneSubRef.current?.unsubscribe();
      actorSubRef.current?.unsubscribe();
    };
  }, []);

  const triggerConcurrencyDemo = async () => {
    setLaneEmitting(true);
    setLaneRuns([]);

    // Subscribe to run events
    laneSubRef.current?.unsubscribe();
    try {
      const sub = await ironflow.subscribe("system.run.>.>", {
        onEvent: (event: SubscriptionEvent) => {
          const data = event.data as { functionId?: string; id?: string; status?: string };
          if (data.functionId !== "concurrency-demo") return;

          const eventType = event.topic.split(".").pop();
          if (eventType === "created" && data.id) {
            setLaneRuns((prev) => [...prev, {
              id: data.id!,
              customerId: laneCustomerId,
              status: "queued",
              startedAt: new Date(),
            }]);
          } else if (eventType === "updated" && data.id && data.status === "running") {
            setLaneRuns((prev) =>
              prev.map((r) => r.id === data.id ? { ...r, status: "running" } : r)
            );
          } else if ((eventType === "completed" || eventType === "failed") && data.id) {
            setLaneRuns((prev) =>
              prev.map((r) => r.id === data.id ? { ...r, status: "completed" } : r)
            );
          }
        },
      });
      laneSubRef.current = sub;
    } catch (err) {
      console.error("Subscribe failed:", err);
    }

    // Emit N events for the same customer
    for (let i = 0; i < laneCount; i++) {
      try {
        await ironflow.emit("demo.concurrency", {
          customerId: laneCustomerId,
          index: i + 1,
        });
        await new Promise((r) => setTimeout(r, 200));
      } catch (err) {
        console.error("Emit failed:", err);
      }
    }

    setLaneEmitting(false);
  };

  const triggerActorDemo = async () => {
    setActorEmitting(true);
    setActorRuns([]);

    actorSubRef.current?.unsubscribe();
    try {
      const sub = await ironflow.subscribe("system.run.>.>", {
        onEvent: (event: SubscriptionEvent) => {
          const data = event.data as { functionId?: string; id?: string; status?: string; output?: { workerId?: string } };
          if (data.functionId !== "actor-demo") return;

          const eventType = event.topic.split(".").pop();
          if (eventType === "created" && data.id) {
            setActorRuns((prev) => [...prev, {
              id: data.id!,
              userId: actorUserId,
              status: "running",
              startedAt: new Date(),
            }]);
          } else if (eventType === "completed" && data.id) {
            setActorRuns((prev) =>
              prev.map((r) =>
                r.id === data.id
                  ? { ...r, status: "completed", workerId: data.output?.workerId }
                  : r
              )
            );
          }
        },
      });
      actorSubRef.current = sub;
    } catch (err) {
      console.error("Subscribe failed:", err);
    }

    for (let i = 0; i < actorCount; i++) {
      try {
        await ironflow.emit("demo.actor", {
          userId: actorUserId,
          index: i + 1,
        });
        await new Promise((r) => setTimeout(r, 300));
      } catch (err) {
        console.error("Emit failed:", err);
      }
    }

    setActorEmitting(false);
  };

  const runningLanes = laneRuns.filter((r) => r.status === "running").length;
  const queuedLanes = laneRuns.filter((r) => r.status === "queued").length;
  const completedLanes = laneRuns.filter((r) => r.status === "completed").length;

  return (
    <div className="container mx-auto py-8 px-4">
      <section className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Concurrency & Actors</h1>
        <p className="text-muted-foreground mb-4">
          Demonstrate concurrency lanes (rate limiting per key) and actor-based sticky routing.
        </p>
      </section>

      {/* Concurrency Lanes */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" /> Concurrency Lanes
          </CardTitle>
          <CardDescription>
            The <code>concurrency-demo</code> function limits to 2 concurrent runs per <code>customerId</code>.
            Excess runs are queued.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label>Customer ID</Label>
              <Input
                value={laneCustomerId}
                onChange={(e) => setLaneCustomerId(e.target.value)}
                className="mt-1 font-mono"
                disabled={laneEmitting}
              />
            </div>
            <div>
              <Label>Number of events</Label>
              <Input
                type="number"
                value={laneCount}
                onChange={(e) => setLaneCount(parseInt(e.target.value) || 1)}
                min={1}
                max={10}
                className="mt-1"
                disabled={laneEmitting}
              />
            </div>
            <div className="flex items-end">
              <Button onClick={triggerConcurrencyDemo} disabled={laneEmitting}>
                <Play className="h-4 w-4" />
                {laneEmitting ? "Emitting..." : "Trigger"}
              </Button>
            </div>
          </div>

          <Alert>
            <AlertDescription className="flex gap-4">
              <span>Running: <Badge variant="default">{runningLanes}</Badge></span>
              <span>Queued: <Badge variant="secondary">{queuedLanes}</Badge></span>
              <span>Completed: <Badge variant="outline">{completedLanes}</Badge></span>
              <span className="text-muted-foreground">Limit: 2 concurrent</span>
            </AlertDescription>
          </Alert>

          {laneRuns.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {laneRuns.map((run, i) => (
                <div
                  key={run.id}
                  className={`border rounded-lg p-3 text-center ${
                    run.status === "running"
                      ? "border-blue-300 bg-blue-50 dark:bg-blue-950"
                      : run.status === "completed"
                        ? "border-green-300 bg-green-50 dark:bg-green-950"
                        : ""
                  }`}
                >
                  <div className="mb-1">
                    {run.status === "running" ? (
                      <Loader2 className="h-5 w-5 text-blue-500 animate-spin mx-auto" />
                    ) : run.status === "completed" ? (
                      <Check className="h-5 w-5 text-green-500 mx-auto" />
                    ) : (
                      <div className="h-5 w-5 rounded-full border-2 border-dashed mx-auto" />
                    )}
                  </div>
                  <p className="text-xs font-mono">Run #{i + 1}</p>
                  <Badge variant={
                    run.status === "running" ? "default" : run.status === "completed" ? "outline" : "secondary"
                  } className="mt-1">
                    {run.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Actor Routing */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" /> Actor Routing
          </CardTitle>
          <CardDescription>
            The <code>actor-demo</code> function uses <code>actorKey: &quot;userId&quot;</code> for sticky routing.
            All events for the same user are routed to the same worker.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label>User ID</Label>
              <Input
                value={actorUserId}
                onChange={(e) => setActorUserId(e.target.value)}
                className="mt-1 font-mono"
                disabled={actorEmitting}
              />
            </div>
            <div>
              <Label>Number of events</Label>
              <Input
                type="number"
                value={actorCount}
                onChange={(e) => setActorCount(parseInt(e.target.value) || 1)}
                min={1}
                max={10}
                className="mt-1"
                disabled={actorEmitting}
              />
            </div>
            <div className="flex items-end">
              <Button onClick={triggerActorDemo} disabled={actorEmitting}>
                <Play className="h-4 w-4" />
                {actorEmitting ? "Emitting..." : "Trigger"}
              </Button>
            </div>
          </div>

          {actorRuns.length > 0 && (
            <div className="space-y-2">
              {actorRuns.map((run, i) => (
                <div key={run.id} className="border rounded-lg p-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {run.status === "completed" ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
                    )}
                    <span className="text-sm">Run #{i + 1}</span>
                    <Badge variant="outline">{run.userId}</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    {run.workerId && (
                      <Badge variant="secondary" className="text-xs">
                        Worker: {run.workerId}
                      </Badge>
                    )}
                    <Badge variant={run.status === "completed" ? "default" : "secondary"}>
                      {run.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
