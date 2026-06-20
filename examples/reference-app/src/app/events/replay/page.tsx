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
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { History, Play, Send, RotateCcw } from "lucide-react";

interface ReplayEvent {
  id: string;
  topic: string;
  data: unknown;
  timestamp: Date;
  isReplay: boolean;
  sequence?: number;
}

export default function ReplayPage() {
  const [historyCount, setHistoryCount] = useState(0);
  const [replayCount, setReplayCount] = useState(10);
  const [events, setEvents] = useState<ReplayEvent[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isReplaying, setIsReplaying] = useState(false);
  const [replayedCount, setReplayedCount] = useState(0);

  const subscriptionRef = useRef<Subscription | null>(null);

  useEffect(() => {
    return () => {
      subscriptionRef.current?.unsubscribe();
    };
  }, []);

  const generateHistory = async () => {
    setIsGenerating(true);
    const eventTypes = ["order.created", "order.paid", "order.shipped", "user.signup", "user.login"];

    for (let i = 0; i < 15; i++) {
      const eventType = eventTypes[i % eventTypes.length];
      try {
        await ironflow.emit(`demo.replay.${eventType}`, {
          index: i + 1,
          type: eventType,
          amount: Math.floor(Math.random() * 500),
          userId: `user-${Math.floor(Math.random() * 10)}`,
          timestamp: new Date().toISOString(),
        });
        setHistoryCount((prev) => prev + 1);
        await new Promise((r) => setTimeout(r, 200));
      } catch (err) {
        console.error("Emit failed:", err);
      }
    }

    setIsGenerating(false);
  };

  const startReplay = async () => {
    setIsReplaying(true);
    setEvents([]);
    setReplayedCount(0);

    subscriptionRef.current?.unsubscribe();

    try {
      const sub = await ironflow.subscribe("events:demo.replay.>", {
        replay: replayCount,
        onEvent: (event: SubscriptionEvent) => {
          const newEvent: ReplayEvent = {
            id: crypto.randomUUID(),
            topic: event.topic,
            data: event.data,
            timestamp: new Date(),
            isReplay: true,
            sequence: event.meta?.sequence,
          };
          setEvents((prev) => [...prev, newEvent]);
          setReplayedCount((prev) => prev + 1);
        },
      });

      subscriptionRef.current = sub;

      // Stop replaying indicator after a delay
      setTimeout(() => setIsReplaying(false), replayCount * 300 + 2000);
    } catch (err) {
      console.error("Replay failed:", err);
      setIsReplaying(false);
    }
  };

  const reset = () => {
    subscriptionRef.current?.unsubscribe();
    subscriptionRef.current = null;
    setEvents([]);
    setReplayedCount(0);
    setIsReplaying(false);
  };

  return (
    <div className="h-full flex flex-col">
      <section className="mb-6 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Event Replay</h1>
        <p className="text-muted-foreground mb-4">
          Generate historical events, then replay them through a subscription to see time-travel event delivery.
        </p>
        <Alert>
          <History className="h-4 w-4" />
          <AlertDescription>
            Replay uses the <code>replay: N</code> subscription option to receive the last N events from the stream before switching to live delivery.
          </AlertDescription>
        </Alert>
      </section>

      <div className="grid gap-6 lg:grid-cols-3 min-h-0 flex-1">
        <div className="space-y-6 overflow-y-auto">
          {/* Step 1: Generate History */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Badge variant="outline">1</Badge> Generate History
              </CardTitle>
              <CardDescription>Emit events to build up a history</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button onClick={generateHistory} disabled={isGenerating}>
                <Send className="h-4 w-4" />
                {isGenerating ? "Generating..." : "Generate 15 Events"}
              </Button>
              <p className="text-sm text-muted-foreground">
                Events generated: <span className="font-mono font-bold">{historyCount}</span>
              </p>
            </CardContent>
          </Card>

          {/* Step 2: Replay */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Badge variant="outline">2</Badge> Start Replay
              </CardTitle>
              <CardDescription>Subscribe with replay to receive historical events</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Replay count: {replayCount}</Label>
                <Slider
                  value={[replayCount]}
                  onValueChange={([v]) => setReplayCount(v)}
                  min={1}
                  max={20}
                  step={1}
                  className="mt-2"
                  disabled={isReplaying}
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={startReplay} disabled={isReplaying || historyCount === 0}>
                  <Play className="h-4 w-4" />
                  {isReplaying ? "Replaying..." : "Start Replay"}
                </Button>
                <Button onClick={reset} variant="outline" size="icon">
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Stats */}
          <Card>
            <CardHeader>
              <CardTitle>Replay Stats</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-center">
                <div>
                  <p className="text-2xl font-bold">{replayedCount}</p>
                  <p className="text-xs text-muted-foreground">Replayed</p>
                </div>
                <div>
                  <p className="text-2xl font-bold">{historyCount}</p>
                  <p className="text-xs text-muted-foreground">Total History</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Timeline */}
        <Card className="lg:col-span-2 flex flex-col min-h-0">
          <CardHeader className="shrink-0">
            <CardTitle className="flex items-center gap-2">
              Event Timeline <Badge variant="secondary">{events.length}</Badge>
            </CardTitle>
            <CardDescription>Events appear as they are replayed from history</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto min-h-0">
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">
                Generate history, then start a replay to see events appear here.
              </p>
            ) : (
              <div className="space-y-2">
                {events.map((event, index) => (
                  <div
                    key={event.id}
                    className="border rounded-lg p-3 animate-in fade-in slide-in-from-left-2"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">#{index + 1}</Badge>
                        <Badge variant="secondary">{event.isReplay ? "replay" : "live"}</Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {event.timestamp.toLocaleTimeString()}
                      </span>
                    </div>
                    <code className="text-xs text-muted-foreground">{event.topic}</code>
                    <pre className="text-xs bg-muted p-2 rounded mt-1 overflow-x-auto">
                      {JSON.stringify(event.data, null, 2)}
                    </pre>
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
