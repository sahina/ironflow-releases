"use client";

import { useState, useRef, useEffect } from "react";
import { ironflow, type Subscription } from "@ironflow/browser";
import { Radio, WifiOff, Trash2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ErrorAlert } from "@/components/error-alert";

interface ReceivedStreamEvent {
  id: string;
  name: string;
  data: Record<string, unknown>;
  entityVersion: number;
  version: number;
  timestamp: string;
  receivedAt: Date;
}

export default function EntityStreamSubscribePage() {
  const [entityId, setEntityId] = useState("account-001");
  const [entityType, setEntityType] = useState("bank-account");
  const [replayCount, setReplayCount] = useState(0);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [events, setEvents] = useState<ReceivedStreamEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const subscriptionRef = useRef<Subscription | null>(null);

  const subscribe = async () => {
    setError(null);

    if (!ironflow.isConfigured) {
      setError("Client not configured. Please wait for connection.");
      return;
    }

    try {
      const subscription = await ironflow.streams.subscribe(entityId, {
        entityType,
        onEvent: (event) => {
          const received: ReceivedStreamEvent = {
            id: event.id || crypto.randomUUID(),
            name: event.name,
            data: event.data,
            entityVersion: event.entityVersion,
            version: event.version,
            timestamp: event.timestamp,
            receivedAt: new Date(),
          };
          setEvents((prev) => [received, ...prev]);
        },
        onError: (err) => {
          setError(err.message);
        },
        replay: replayCount,
      });

      subscriptionRef.current = subscription;
      setIsSubscribed(true);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to subscribe";
      setError(message);
    }
  };

  const unsubscribe = () => {
    if (subscriptionRef.current) {
      subscriptionRef.current.unsubscribe();
      subscriptionRef.current = null;
    }
    setIsSubscribed(false);
  };

  const clearEvents = () => {
    setEvents([]);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe();
        subscriptionRef.current = null;
      }
    };
  }, []);

  return (
    <div className="container mx-auto py-8 px-4">
      <section className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">
          Subscribe to Entity Streams
        </h1>
        <p className="text-muted-foreground mb-4">
          Subscribe to an entity stream and watch events arrive in real-time as
          they are appended.
        </p>
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Open the Streams page in another tab to append events and watch them
            arrive here in real-time.
          </AlertDescription>
        </Alert>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left Column: Subscribe */}
        <Card>
          <CardHeader>
            <CardTitle>Subscribe</CardTitle>
            <CardDescription>
              Connect to an entity stream to receive events as they are
              appended.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="entityId">Entity ID</Label>
              <Input
                id="entityId"
                value={entityId}
                onChange={(e) => setEntityId(e.target.value)}
                placeholder="e.g., account-001"
                disabled={isSubscribed}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="entityType">Entity Type</Label>
              <Input
                id="entityType"
                value={entityType}
                onChange={(e) => setEntityType(e.target.value)}
                placeholder="e.g., bank-account"
                disabled={isSubscribed}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="replayCount">Replay Count</Label>
              <Input
                id="replayCount"
                type="number"
                min={0}
                value={replayCount}
                onChange={(e) =>
                  setReplayCount(Math.max(0, parseInt(e.target.value) || 0))
                }
                placeholder="0 = new events only"
                disabled={isSubscribed}
              />
              <p className="text-xs text-muted-foreground">
                Number of past events to replay on subscribe. 0 means new events
                only.
              </p>
            </div>

            <ErrorAlert message={error} />

            <Button
              onClick={isSubscribed ? unsubscribe : subscribe}
              variant={isSubscribed ? "destructive" : "default"}
              disabled={!entityId.trim() || !entityType.trim()}
              className="w-full"
            >
              {isSubscribed ? (
                <>
                  <WifiOff className="h-4 w-4" />
                  Unsubscribe
                </>
              ) : (
                <>
                  <Radio className="h-4 w-4" />
                  Subscribe
                </>
              )}
            </Button>

            {isSubscribed && (
              <div className="flex items-center gap-2 p-3 bg-muted rounded-md">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                </span>
                <span className="text-sm text-muted-foreground">
                  Listening on{" "}
                  <code className="font-mono text-foreground">
                    {entityType}.{entityId}
                  </code>
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right Column: Live Events */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  Live Events
                  <Badge variant="secondary">{events.length}</Badge>
                </CardTitle>
                <CardDescription>
                  Events received from the entity stream
                </CardDescription>
              </div>
              {events.length > 0 && (
                <Button variant="outline" size="sm" onClick={clearEvents}>
                  <Trash2 className="h-4 w-4" />
                  Clear
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-[500px] overflow-y-auto">
              {events.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-8">
                  {isSubscribed
                    ? "Listening for events..."
                    : "Subscribe to a stream to start receiving events."}
                </p>
              ) : (
                events.map((event, index) => (
                  <div
                    key={event.id}
                    className="border rounded-lg p-3 space-y-2 animate-in fade-in slide-in-from-top-2"
                    style={{
                      animationDelay: `${index * 50}ms`,
                      animationFillMode: "backwards",
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{event.name}</Badge>
                        <Badge variant="outline" className="text-xs">
                          v{event.entityVersion}
                        </Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {event.receivedAt.toLocaleTimeString()}
                      </span>
                    </div>
                    <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
                      {JSON.stringify(event.data, null, 2)}
                    </pre>
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
