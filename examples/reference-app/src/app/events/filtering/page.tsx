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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Filter, Play, Send, X, Check } from "lucide-react";
import { EventCard } from "@/components/event-card";
import { ErrorAlert } from "@/components/error-alert";

interface FilteredEvent {
  id: string;
  topic: string;
  data: unknown;
  matched: boolean;
  timestamp: Date;
}

const exampleExpressions = [
  { label: "Amount > 100", expr: 'data.amount > 100' },
  { label: 'Type == "order"', expr: 'data.type == "order"' },
  { label: "Priority high/critical", expr: 'data.priority in ["high", "critical"]' },
  { label: "Has metadata", expr: "has(data.metadata)" },
];

export default function FilteringPage() {
  const [filterExpr, setFilterExpr] = useState('data.amount > 100');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [events, setEvents] = useState<FilteredEvent[]>([]);
  const [emitPayload, setEmitPayload] = useState('{"amount": 150, "type": "order"}');
  const [error, setError] = useState<string | null>(null);
  const [matchCount, setMatchCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  const subscriptionRef = useRef<Subscription | null>(null);

  useEffect(() => {
    return () => {
      subscriptionRef.current?.unsubscribe();
    };
  }, []);

  const startSubscription = async () => {
    setError(null);
    subscriptionRef.current?.unsubscribe();

    try {
      const sub = await ironflow.subscribe("events:demo.filter.*", {
        filter: filterExpr,
        onEvent: (event: SubscriptionEvent) => {
          const newEvent: FilteredEvent = {
            id: crypto.randomUUID(),
            topic: event.topic,
            data: event.data,
            matched: true,
            timestamp: new Date(),
          };
          setEvents((prev) => [newEvent, ...prev].slice(0, 50));
          setMatchCount((prev) => prev + 1);
        },
        onError: (err) => {
          setError(err.message);
        },
      });

      subscriptionRef.current = sub;
      setIsSubscribed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Subscription failed");
    }
  };

  const stopSubscription = () => {
    subscriptionRef.current?.unsubscribe();
    subscriptionRef.current = null;
    setIsSubscribed(false);
  };

  const emitEvent = async () => {
    try {
      const data = JSON.parse(emitPayload);
      await ironflow.emit("demo.filter.test", data);
      setTotalCount((prev) => prev + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Emit failed");
    }
  };

  const emitVariedBatch = async () => {
    const testEvents = [
      { amount: 50, type: "refund", priority: "low" },
      { amount: 200, type: "order", priority: "high" },
      { amount: 75, type: "order", priority: "medium" },
      { amount: 300, type: "order", priority: "critical", metadata: { source: "api" } },
      { amount: 10, type: "refund", priority: "low" },
    ];

    for (const data of testEvents) {
      try {
        await ironflow.emit("demo.filter.test", data);
        setTotalCount((prev) => prev + 1);
        await new Promise((r) => setTimeout(r, 300));
      } catch (err) {
        console.error("Emit failed:", err);
      }
    }
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <section className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">CEL Filtering</h1>
        <p className="text-muted-foreground mb-4">
          Subscribe with CEL (Common Expression Language) filter expressions to receive only matching events.
        </p>
        <Alert>
          <Filter className="h-4 w-4" />
          <AlertDescription>
            CEL expressions are evaluated server-side. Only events matching the filter are delivered to subscribers.
          </AlertDescription>
        </Alert>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: Controls */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Filter Expression</CardTitle>
              <CardDescription>Enter a CEL expression to filter events</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>CEL Expression</Label>
                <Input
                  value={filterExpr}
                  onChange={(e) => setFilterExpr(e.target.value)}
                  className="mt-1 font-mono"
                  disabled={isSubscribed}
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Examples:</Label>
                <div className="flex flex-wrap gap-1">
                  {exampleExpressions.map((ex) => (
                    <Button
                      key={ex.expr}
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      onClick={() => setFilterExpr(ex.expr)}
                      disabled={isSubscribed}
                    >
                      {ex.label}
                    </Button>
                  ))}
                </div>
              </div>

              {!isSubscribed ? (
                <Button onClick={startSubscription} className="w-full">
                  <Play className="h-4 w-4" />
                  Subscribe with Filter
                </Button>
              ) : (
                <Button onClick={stopSubscription} variant="secondary" className="w-full">
                  <X className="h-4 w-4" />
                  Unsubscribe
                </Button>
              )}

              <ErrorAlert message={error} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Emit Test Events</CardTitle>
              <CardDescription>Send events to test the filter</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Event payload (JSON)</Label>
                <Textarea
                  value={emitPayload}
                  onChange={(e) => setEmitPayload(e.target.value)}
                  className="mt-1 font-mono text-xs"
                  rows={3}
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={emitEvent} size="sm" disabled={!isSubscribed}>
                  <Send className="h-4 w-4" />
                  Emit One
                </Button>
                <Button onClick={emitVariedBatch} size="sm" variant="outline" disabled={!isSubscribed}>
                  Emit 5 Varied
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Stats</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-center">
                <div>
                  <p className="text-2xl font-bold">{totalCount}</p>
                  <p className="text-xs text-muted-foreground">Emitted</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-green-600">{matchCount}</p>
                  <p className="text-xs text-muted-foreground">Matched</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: Events */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Matched Events <Badge variant="secondary">{events.length}</Badge>
            </CardTitle>
            <CardDescription>Events that passed the CEL filter</CardDescription>
          </CardHeader>
          <CardContent>
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">
                {isSubscribed
                  ? "Emit events to see which ones match the filter."
                  : "Subscribe with a filter expression to start."}
              </p>
            ) : (
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {events.map((event) => (
                  <EventCard key={event.id} data={event.data} timestamp={event.timestamp}>
                    <Badge variant="default" className="flex items-center gap-1">
                      <Check className="h-3 w-3" /> Matched
                    </Badge>
                  </EventCard>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
