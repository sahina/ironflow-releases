"use client";

import { useState } from "react";
import { ironflow, type StreamEvent } from "@ironflow/browser";
import { createUpcasterRegistry } from "@ironflow/core";
import { ArrowDown, Plus, RefreshCw } from "lucide-react";
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

const ENTITY_ID = "upcasting-demo-001";

// Set up the upcaster registry at module level
const registry = createUpcasterRegistry();
registry.register("money.deposited", 1, 2, (data) => {
  const d = data as { amount: number };
  return { ...d, currency: "USD" };
});

interface UpcastedEvent {
  event: StreamEvent;
  rawData: Record<string, unknown>;
  upcastedData: unknown;
}

export default function UpcastingPage() {
  const [appendCount, setAppendCount] = useState(0);
  const [appending, setAppending] = useState(false);
  const [appendError, setAppendError] = useState<string | null>(null);

  const [upcastedEvents, setUpcastedEvents] = useState<UpcastedEvent[]>([]);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);

  const handleAppendV1 = async () => {
    setAppendError(null);

    if (!ironflow.isConfigured) {
      setAppendError("Client not configured. Please wait for connection.");
      return;
    }

    setAppending(true);
    try {
      const amount = Math.floor(Math.random() * 200) + 10;
      await ironflow.streams.append(
        ENTITY_ID,
        {
          name: "money.deposited",
          data: { amount },
          entityType: "bank-account",
        },
        { version: 1 }
      );
      setAppendCount((prev) => prev + 1);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to append event";
      setAppendError(message);
    } finally {
      setAppending(false);
    }
  };

  const handleReadAndUpcast = async () => {
    setReadError(null);

    if (!ironflow.isConfigured) {
      setReadError("Client not configured. Please wait for connection.");
      return;
    }

    setReading(true);
    try {
      const result = await ironflow.streams.read(ENTITY_ID);

      const processed: UpcastedEvent[] = result.events.map((event) => {
        let upcastedData: unknown = event.data;
        if (event.name === "money.deposited" && event.version === 1) {
          upcastedData = registry.upcast("money.deposited", event.data, 1, 2);
        }
        return {
          event,
          rawData: { ...event.data },
          upcastedData,
        };
      });

      setUpcastedEvents(processed);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to read stream";
      setReadError(message);
    } finally {
      setReading(false);
    }
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <section className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Upcasting</h1>
        <p className="text-muted-foreground">
          Demonstrate event schema versioning. Old v1 events are transparently
          upcasted to v2 when read, adding default values for new fields.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left Column: Schema + Append */}
        <div className="space-y-6">
          {/* Card 1: Event Schema Versions */}
          <Card>
            <CardHeader>
              <CardTitle>Event Schema Versions</CardTitle>
              <CardDescription>
                How the <code className="font-mono">money.deposited</code> event
                evolved over time
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* v1 schema */}
              <div className="border rounded-lg p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">v1</Badge>
                  <span className="text-sm font-medium">Original</span>
                </div>
                <pre className="text-xs bg-muted p-3 rounded font-mono overflow-x-auto">
                  {JSON.stringify({ amount: "number" }, null, 2)}
                </pre>
              </div>

              {/* Arrow */}
              <div className="flex justify-center">
                <ArrowDown className="h-5 w-5 text-muted-foreground" />
              </div>

              {/* v2 schema */}
              <div className="border rounded-lg p-4 space-y-2 border-green-500/30 bg-green-500/5">
                <div className="flex items-center gap-2">
                  <Badge className="bg-green-600 text-white">v2</Badge>
                  <span className="text-sm font-medium">Added currency</span>
                </div>
                <pre className="text-xs bg-muted p-3 rounded font-mono overflow-x-auto">
                  {JSON.stringify(
                    { amount: "number", currency: "string" },
                    null,
                    2
                  )}
                </pre>
              </div>

              {/* Upcaster explanation */}
              <div className="bg-muted rounded-md p-3 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  Upcaster chain:
                </span>{" "}
                v1 &rarr; v2: adds{" "}
                <code className="font-mono text-foreground">
                  currency: &quot;USD&quot;
                </code>{" "}
                default
              </div>
            </CardContent>
          </Card>

          {/* Card 2: Append v1 Events */}
          <Card>
            <CardHeader>
              <CardTitle>Append v1 Events</CardTitle>
              <CardDescription>
                Simulate appending legacy v1 events to the stream
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ErrorAlert message={appendError} />

              <Button
                onClick={handleAppendV1}
                disabled={appending}
                className="w-full"
              >
                {appending ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Appending...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" />
                    Append v1 money.deposited
                  </>
                )}
              </Button>

              <p className="text-sm text-muted-foreground text-center">
                {appendCount === 0
                  ? "No events appended yet"
                  : `${appendCount} event${appendCount === 1 ? "" : "s"} appended this session`}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Read & Upcast */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Read & Upcast</CardTitle>
                <CardDescription>
                  Read events from the stream and apply upcasters
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleReadAndUpcast}
                disabled={reading}
              >
                <RefreshCw
                  className={`h-4 w-4 ${reading ? "animate-spin" : ""}`}
                />
                Read & Upcast
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <ErrorAlert message={readError} />

            <div className="space-y-3 max-h-[600px] overflow-y-auto">
              {upcastedEvents.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-8">
                  Append some v1 events, then click Read & Upcast to see the
                  transformation.
                </p>
              ) : (
                upcastedEvents.map((item, index) => (
                  <div
                    key={item.event.id}
                    className="border rounded-lg p-3 space-y-3 animate-in fade-in slide-in-from-top-2"
                    style={{
                      animationDelay: `${index * 50}ms`,
                      animationFillMode: "backwards",
                    }}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="secondary">{item.event.name}</Badge>
                      <span className="text-xs text-muted-foreground">
                        #{item.event.entityVersion}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        stored v{item.event.version}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      {/* Raw v1 data */}
                      <div className="space-y-1">
                        <span className="text-xs font-medium text-muted-foreground">
                          Raw (v1)
                        </span>
                        <pre className="text-xs bg-muted p-2 rounded font-mono overflow-x-auto">
                          {JSON.stringify(item.rawData, null, 2)}
                        </pre>
                      </div>

                      {/* Upcasted v2 data */}
                      <div className="space-y-1">
                        <span className="text-xs font-medium text-green-600 dark:text-green-400">
                          Upcasted (v2)
                        </span>
                        <pre className="text-xs bg-green-500/10 p-2 rounded font-mono overflow-x-auto">
                          {JSON.stringify(item.upcastedData, null, 2)}
                        </pre>
                      </div>
                    </div>
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
