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

interface ReceivedMessage {
  id: string;
  topic: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  timestamp: Date;
}

export default function PubSubSubscribePage() {
  const [pattern, setPattern] = useState("demo.>");
  const [replay, setReplay] = useState("0");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [messages, setMessages] = useState<ReceivedMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const subscriptionRef = useRef<Subscription | null>(null);

  const subscribe = async () => {
    setError(null);

    if (!ironflow.isConfigured) {
      setError("Client not configured. Please wait for connection.");
      return;
    }

    try {
      const replayCount = parseInt(replay, 10);
      const subscription = await ironflow.subscribe(pattern, {
        ...(replayCount > 0 && { replay: replayCount }),
        onEvent: (event: SubscriptionEvent) => {
          const msg: ReceivedMessage = {
            id: event.eventId || crypto.randomUUID(),
            topic: event.topic,
            data: event.data,
            timestamp: new Date(),
          };
          setMessages((prev) => [msg, ...prev]);
        },
        onError: (err) => {
          setError(err.message);
        },
      });

      subscriptionRef.current = subscription;
      setIsSubscribed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to subscribe");
    }
  };

  const unsubscribe = () => {
    subscriptionRef.current?.unsubscribe();
    subscriptionRef.current = null;
    setIsSubscribed(false);
  };

  const clearMessages = () => {
    setMessages([]);
  };

  useEffect(() => {
    return () => {
      subscriptionRef.current?.unsubscribe();
      subscriptionRef.current = null;
    };
  }, []);

  return (
    <div className="container mx-auto py-8 px-4">
      <section className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Subscribe to Topics</h1>
        <p className="text-muted-foreground mb-4">
          Subscribe to developer pub/sub topics with pattern matching and see messages arrive
          in real-time.
        </p>
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Topic subscriptions use the same pattern matching as event subscriptions.
            Use <code>demo.&gt;</code> for all demo topics or <code>orders.*</code> for
            order-level topics.
          </AlertDescription>
        </Alert>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: Subscription Controls */}
        <Card>
          <CardHeader>
            <CardTitle>Subscription</CardTitle>
            <CardDescription>
              Enter a topic pattern to subscribe. Use * for single-level and &gt; for multi-level wildcards.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pattern">Topic Pattern</Label>
              <Input
                id="pattern"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                placeholder="e.g., demo.>, orders.*, notifications.email"
                disabled={isSubscribed}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="replay">Replay last N messages</Label>
              <Input
                id="replay"
                type="number"
                min="0"
                value={replay}
                onChange={(e) => setReplay(e.target.value)}
                placeholder="0 = no replay"
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
                  Listening on <code className="font-mono text-foreground">{pattern}</code>
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right: Messages */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  Messages
                  <Badge variant="secondary">{messages.length}</Badge>
                </CardTitle>
                <CardDescription>Messages matching your topic pattern</CardDescription>
              </div>
              {messages.length > 0 && (
                <Button variant="outline" size="sm" onClick={clearMessages}>
                  <Trash2 className="h-4 w-4" />
                  Clear
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-[500px] overflow-y-auto">
              {messages.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-8">
                  {isSubscribed
                    ? "Waiting for messages..."
                    : "Subscribe to a topic pattern to start receiving messages."}
                </p>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className="border rounded-lg p-3 space-y-2 animate-in fade-in slide-in-from-top-2"
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <Badge variant="outline">{msg.topic}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {msg.timestamp.toLocaleTimeString()}
                      </span>
                    </div>
                    {msg.data && (
                      <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
                        {JSON.stringify(msg.data, null, 2)}
                      </pre>
                    )}
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
