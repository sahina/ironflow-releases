"use client";

import { useState, useRef, useEffect } from "react";
import { ironflow, type Subscription, type SubscriptionEvent } from "@ironflow/browser";
import { Check, Copy, Loader2, Send, Webhook } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorAlert } from "@/components/error-alert";
import { Alert, AlertDescription } from "@/components/ui/alert";

const SAMPLE_PAYLOADS: Record<string, string> = {
  github: JSON.stringify(
    {
      action: "opened",
      delivery: "abc-123-def-456",
      repository: { full_name: "user/repo" },
      pull_request: { title: "Fix bug in auth flow", number: 42 },
    },
    null,
    2
  ),
  stripe: JSON.stringify(
    {
      id: "evt_1234567890",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_abc123",
          amount: 2000,
          currency: "usd",
          status: "succeeded",
        },
      },
    },
    null,
    2
  ),
};

const WEBHOOK_SOURCES = [
  { id: "github", label: "GitHub", pattern: "github.>" },
  { id: "stripe", label: "Stripe", pattern: "stripe.>" },
];

interface TransformedEvent {
  id: string;
  topic: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  timestamp: Date;
}

export default function WebhooksPage() {
  const [source, setSource] = useState("github");
  const [payload, setPayload] = useState(SAMPLE_PAYLOADS.github);
  const [isSending, setIsSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<TransformedEvent[]>([]);
  const [copied, setCopied] = useState(false);
  const subscriptionRef = useRef<Subscription | null>(null);

  // Subscribe to webhook events
  useEffect(() => {
    if (!ironflow.isConfigured) return;

    const subscribeToWebhookEvents = async () => {
      subscriptionRef.current?.unsubscribe();
      try {
        const sub = await ironflow.subscribe(`${source}.>`, {
          replay: 10,
          onEvent: (event: SubscriptionEvent) => {
            setEvents((prev) => [
              {
                id: event.eventId || crypto.randomUUID(),
                topic: event.topic,
                data: event.data,
                timestamp: new Date(),
              },
              ...prev,
            ].slice(0, 20));
          },
          onError: (err) => console.error("Subscription error:", err.code, err.message, err),
        });
        subscriptionRef.current = sub;
      } catch (err) {
        console.error("Failed to subscribe:", err);
      }
    };

    subscribeToWebhookEvents();
    return () => {
      subscriptionRef.current?.unsubscribe();
    };
  }, [source]);

  const handleSourceChange = (newSource: string) => {
    setSource(newSource);
    setPayload(SAMPLE_PAYLOADS[newSource] || "{}");
    setSendResult(null);
    setError(null);
    setEvents([]);
  };

  const sendTestWebhook = async () => {
    setIsSending(true);
    setError(null);
    setSendResult(null);

    try {
      const response = await fetch(`/api/ironflow/webhooks/${source}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      setSendResult("Webhook received and transformed into event");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send webhook");
    } finally {
      setIsSending(false);
    }
  };

  const copyEndpoint = (webhookId: string) => {
    const url = `${window.location.origin}/api/ironflow/webhooks/${webhookId}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <section className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Webhook Ingestion</h1>
        <p className="text-muted-foreground mb-4">
          Convert incoming HTTP webhooks into Ironflow events. Each webhook source has its
          own endpoint that verifies, transforms, and emits events.
        </p>
        <Alert>
          <Webhook className="h-4 w-4" />
          <AlertDescription>
            Webhooks follow a pipeline: <strong>HTTP POST</strong> → <strong>verify</strong> (signature check) → <strong>transform</strong> (extract event name + data) → <strong>Ironflow event</strong>
          </AlertDescription>
        </Alert>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          {/* Registered Webhooks */}
          <Card>
            <CardHeader>
              <CardTitle>Registered Webhooks</CardTitle>
              <CardDescription>Webhook sources configured in this demo</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {WEBHOOK_SOURCES.map((wh) => (
                <div key={wh.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <p className="font-medium text-sm">{wh.label}</p>
                    <code className="text-xs text-muted-foreground">/api/ironflow/webhooks/{wh.id}</code>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{wh.pattern}</Badge>
                    <Button variant="ghost" size="sm" onClick={() => copyEndpoint(wh.id)}>
                      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Test Webhook */}
          <Card>
            <CardHeader>
              <CardTitle>Test Webhook</CardTitle>
              <CardDescription>Send a simulated webhook payload</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Source</Label>
                <Select value={source} onValueChange={handleSourceChange}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="github">GitHub</SelectItem>
                    <SelectItem value="stripe">Stripe</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Payload (JSON)</Label>
                <Textarea
                  value={payload}
                  onChange={(e) => setPayload(e.target.value)}
                  className="mt-1 font-mono text-sm"
                  rows={8}
                />
              </div>

              <Button onClick={sendTestWebhook} disabled={isSending}>
                {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {isSending ? "Sending..." : "Send Test Webhook"}
              </Button>

              <ErrorAlert message={error} />

              {sendResult && (
                <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg">
                  <Check className="h-4 w-4 text-green-600" />
                  <span className="text-sm text-green-700 dark:text-green-300">{sendResult}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Events Feed */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Transformed Events
              <Badge variant="secondary">{events.length}</Badge>
            </CardTitle>
            <CardDescription>
              Events created from webhook payloads (subscribed to <code>{source}.&gt;</code>)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-[600px] overflow-y-auto">
              {events.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-8">
                  Send a test webhook to see transformed events appear here.
                </p>
              ) : (
                events.map((event) => (
                  <div key={event.id} className="border rounded-lg p-3 space-y-2 animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <Badge variant="outline">{event.topic}</Badge>
                      <span className="text-xs text-muted-foreground">{event.timestamp.toLocaleTimeString()}</span>
                    </div>
                    {event.data && (
                      <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
                        {JSON.stringify(event.data, null, 2)}
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
