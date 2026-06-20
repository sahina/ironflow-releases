"use client";

import { useState, useRef, useEffect } from "react";
import { ironflow, type Subscription, type SubscriptionEvent } from "@ironflow/browser";
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
import { EventEmitForm } from "@/components/event-emit-form";
import { EventCardWithBadge } from "@/components/event-card";

interface ReceivedEvent {
  id: string;
  name: string;
  data: unknown;
  timestamp: Date;
}

export default function SubscribeEventsPage() {
  const [pattern, setPattern] = useState("events:>");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [events, setEvents] = useState<ReceivedEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const subscriptionRef = useRef<Subscription | null>(null);

  const subscribe = async () => {
    setError(null);

    if (!ironflow.isConfigured) {
      setError("Client not configured. Please wait for connection.");
      return;
    }

    try {
      const subscription = await ironflow.subscribe(pattern, {
        onEvent: (event: SubscriptionEvent) => {
          const newEvent: ReceivedEvent = {
            id: event.eventId || crypto.randomUUID(),
            name: event.topic,
            data: event.data,
            timestamp: new Date(),
          };
          setEvents((prev) => [newEvent, ...prev]);
        },
        onError: (err) => {
          setError(err.message);
        },
      });

      subscriptionRef.current = subscription;
      setIsSubscribed(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to subscribe";
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
          Subscribe to Events
        </h1>
        <p className="text-muted-foreground mb-4">
          Subscribe to event streams with pattern matching and see events arrive
          in real-time.
        </p>
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Subscriptions are tied to this page. Navigating away will automatically
            unsubscribe and clean up the connection.
          </AlertDescription>
        </Alert>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left Column: Subscription + Quick Emit */}
        <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Subscription</CardTitle>
            <CardDescription>
              Enter a pattern to subscribe to events. Use events:* for all events.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pattern">Event Pattern</Label>
              <Input
                id="pattern"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                placeholder="e.g., events:>, events:user.*, events:order.placed"
                disabled={isSubscribed}
              />
            </div>

            <ErrorAlert message={error} />

            <Button
              onClick={isSubscribed ? unsubscribe : subscribe}
              variant={isSubscribed ? "destructive" : "default"}
              disabled={!pattern.trim()}
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
                  Listening for <code className="font-mono text-foreground">{pattern}</code>
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Emit */}
        <Card>
          <CardHeader>
            <CardTitle>Quick Emit</CardTitle>
            <CardDescription>
              Send events to test your subscription without leaving this page
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EventEmitForm
              compact
              defaultName="user.created"
              defaultData={'{\n  "userId": "usr_123",\n  "email": "user@example.com"\n}'}
            />
          </CardContent>
        </Card>
        </div>

        {/* Right Column: Received Events */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  Received Events
                  <Badge variant="secondary">{events.length}</Badge>
                </CardTitle>
                <CardDescription>
                  Events matching your subscription pattern
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
                    ? "Waiting for events..."
                    : "Subscribe to a pattern to start receiving events."}
                </p>
              ) : (
                events.map((event, index) => (
                  <EventCardWithBadge
                    key={event.id}
                    name={event.name}
                    data={event.data}
                    timestamp={event.timestamp}
                    style={{
                      animationDelay: `${index * 50}ms`,
                      animationFillMode: "backwards",
                    }}
                  />
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
