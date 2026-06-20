"use client";

import { useState, useEffect } from "react";
import { ironflow, type Subscription, type SubscriptionEvent } from "@ironflow/browser";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EventCardWithBadge } from "@/components/event-card";

const patterns = ["events:>", "events:user.*", "events:user.created"];

const testEvents = [
  { name: "user.created", data: { userId: "1" } },
  { name: "user.updated", data: { userId: "1" } },
  { name: "order.placed", data: { orderId: "1" } },
];

const patternDescriptions: Record<string, string> = {
  "events:>": "Matches ALL events (multi-level wildcard)",
  "events:user.*": "Matches user.* events (single-level wildcard)",
  "events:user.created": "Matches only user.created (exact match)",
};

interface ReceivedEvent {
  id: string;
  name: string;
  data: unknown;
  timestamp: Date;
}

interface PatternColumn {
  pattern: string;
  events: ReceivedEvent[];
}

export default function PatternMatchingPage() {
  const [columns, setColumns] = useState<PatternColumn[]>(
    patterns.map((pattern) => ({
      pattern,
      events: [],
    }))
  );
  const [isEmitting, setIsEmitting] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const subs: Subscription[] = [];

    // Defer subscription setup with setTimeout so that React StrictMode's
    // synchronous cleanup→re-mount cycle can clearTimeout the first invocation
    // before it ever starts, preventing duplicate/competing subscribe calls.
    const timeoutId = setTimeout(async () => {
      // Wait for client to be configured
      let attempts = 0;
      while (!ironflow.isConfigured && attempts < 50) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        attempts++;
        if (!isMounted) return;
      }

      if (!ironflow.isConfigured || !isMounted) return;

      for (let i = 0; i < patterns.length; i++) {
        if (!isMounted) break;

        const pattern = patterns[i];
        const columnIndex = i;

        try {
          const subscription = await ironflow.subscribe(pattern, {
            onEvent: (event: SubscriptionEvent) => {
              const newEvent: ReceivedEvent = {
                id: event.eventId || crypto.randomUUID(),
                name: event.topic,
                data: event.data,
                timestamp: new Date(),
              };

              setColumns((prev) =>
                prev.map((col, idx) =>
                  idx === columnIndex
                    ? { ...col, events: [newEvent, ...col.events] }
                    : col
                )
              );
            },
            onError: (err) => {
              console.error(`Subscription error for ${pattern}:`, err);
            },
          });

          if (isMounted) {
            subs.push(subscription);
          } else {
            subscription.unsubscribe();
          }
        } catch (err) {
          if (err instanceof Error && err.message.includes("Already subscribed")) {
            continue;
          }
          console.error(`Failed to subscribe to ${pattern}:`, err);
        }
      }
    }, 0);

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
      subs.forEach((sub) => sub.unsubscribe());
    };
  }, []);

  const emitTestEvents = async () => {
    setIsEmitting(true);

    for (const event of testEvents) {
      try {
        await ironflow.emit(event.name, event.data);
      } catch (err) {
        console.error(`Failed to emit ${event.name}:`, err);
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    setIsEmitting(false);
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <section className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">
          Pattern Matching
        </h1>
        <p className="text-muted-foreground">
          Visualize how wildcard patterns work by comparing which events each
          subscription receives.
        </p>
      </section>

      {/* Control Card */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Emit Test Events</CardTitle>
          <CardDescription>
            Fire a sequence of test events to see how each pattern matches
            differently
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <Button onClick={emitTestEvents} disabled={isEmitting}>
              <Send className="h-4 w-4" />
              {isEmitting ? "Emitting..." : "Emit Test Events"}
            </Button>
            <div className="flex flex-wrap gap-2">
              {testEvents.map((event) => (
                <Badge key={event.name} variant="outline">
                  {event.name}
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pattern Columns Grid */}
      <div className="grid gap-6 md:grid-cols-3">
        {columns.map((column) => (
          <Card key={column.pattern}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <code className="text-lg font-mono bg-muted px-2 py-1 rounded">
                  {column.pattern}
                </code>
                <Badge variant="secondary">{column.events.length}</Badge>
              </div>
              <CardDescription>
                {patternDescriptions[column.pattern]}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 max-h-[400px] overflow-y-auto">
                {column.events.length === 0 ? (
                  <p className="text-muted-foreground text-sm text-center py-8">
                    No events received yet
                  </p>
                ) : (
                  column.events.map((event) => (
                    <EventCardWithBadge key={event.id} name={event.name} data={event.data} timestamp={event.timestamp} />
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
