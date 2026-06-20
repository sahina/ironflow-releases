"use client";

import { useState, useRef, useEffect } from "react";
import { ironflow, type Subscription, type SubscriptionEvent } from "@ironflow/browser";
import { Check, Key, Loader2, Lock, Play, Shield } from "lucide-react";
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
import { Alert, AlertDescription } from "@/components/ui/alert";

interface SecretsResult {
  apiKeyPresent: boolean;
  apiKeyPreview: string;
  webhookUrlPresent: boolean;
  webhookUrlPreview: string;
  checkedAt: string;
}

interface SystemEvent {
  id: string;
  topic: string;
  type: string;
  timestamp: Date;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

const REQUIRED_SECRETS = [
  { name: "DEMO_API_KEY", description: "API key for external service integration" },
  { name: "DEMO_WEBHOOK_URL", description: "Webhook endpoint URL for notifications" },
];

export default function SecretsDemoPage() {
  const [runId, setRunId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SecretsResult | null>(null);
  const [systemEvents, setSystemEvents] = useState<SystemEvent[]>([]);
  const subscriptionRef = useRef<Subscription | null>(null);

  useEffect(() => {
    return () => {
      subscriptionRef.current?.unsubscribe();
    };
  }, []);

  const startWorkflow = async () => {
    setIsRunning(true);
    setError(null);
    setResult(null);
    setSystemEvents([]);

    try {
      const triggerResult = await ironflow.invoke("demo.secrets", {
        data: {},
      });

      if (triggerResult.runIds.length > 0) {
        const rid = triggerResult.runIds[0];
        setRunId(rid);

        subscriptionRef.current?.unsubscribe();
        const sub = await ironflow.subscribe(`system.run.${rid}.>`, {
          replay: 100,
          onEvent: (event: SubscriptionEvent) => {
            setSystemEvents((prev) => [
              {
                id: event.eventId || crypto.randomUUID(),
                topic: event.topic,
                type: event.topic.split(".").pop() || "unknown",
                timestamp: new Date(),
                data: event.data,
              },
              ...prev,
            ].slice(0, 20));

            if (event.topic.endsWith(".completed") && !event.topic.includes(".step.")) {
              setIsRunning(false);
              const data = event.data as Record<string, unknown>;
              const output = data.output as SecretsResult | undefined;
              if (output) setResult(output);
            } else if (event.topic.endsWith(".failed") && !event.topic.includes(".step.")) {
              setIsRunning(false);
              setError("Workflow failed");
            }
          },
          onError: (err) => {
            console.error("Subscription error:", err.code, err.message, err);
            setError(`Subscription error: ${err.message || "Unknown"} (${err.code || "?"})`);
          },
        });
        subscriptionRef.current = sub;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start workflow");
      setIsRunning(false);
    }
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <section className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Secrets Management</h1>
        <p className="text-muted-foreground mb-4">
          Declare required secrets in function config. The Ironflow server resolves them
          at runtime and injects them into the function context.
        </p>
        <Alert>
          <Shield className="h-4 w-4" />
          <AlertDescription>
            Secrets are resolved server-side and never exposed to the browser. Functions
            declare which secrets they need in their config.
          </AlertDescription>
        </Alert>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          {/* How It Works */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                How It Works
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3">
                <Badge variant="outline" className="mt-0.5">1</Badge>
                <div>
                  <p className="text-sm font-medium">Declare in function config</p>
                  <pre className="text-xs bg-muted p-2 rounded mt-1">{`secrets: ["DEMO_API_KEY", "DEMO_WEBHOOK_URL"]`}</pre>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Badge variant="outline" className="mt-0.5">2</Badge>
                <div>
                  <p className="text-sm font-medium">Set values on the server</p>
                  <pre className="text-xs bg-muted p-2 rounded mt-1">{`ironflow secret set DEMO_API_KEY "sk-abc123..."`}</pre>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Badge variant="outline" className="mt-0.5">3</Badge>
                <div>
                  <p className="text-sm font-medium">Access at runtime</p>
                  <pre className="text-xs bg-muted p-2 rounded mt-1">{`const key = secrets.get("DEMO_API_KEY")\nconst exists = secrets.has("DEMO_API_KEY")`}</pre>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Required Secrets */}
          <Card>
            <CardHeader>
              <CardTitle>Required Secrets</CardTitle>
              <CardDescription>Secrets declared by the demo function</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {REQUIRED_SECRETS.map((secret) => (
                <div key={secret.name} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center gap-2">
                    <Lock className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <code className="text-sm font-mono">{secret.name}</code>
                      <p className="text-xs text-muted-foreground">{secret.description}</p>
                    </div>
                  </div>
                  <Badge variant="secondary">Required</Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Run Demo */}
          <Card>
            <CardHeader>
              <CardTitle>Run Demo</CardTitle>
              <CardDescription>Trigger the workflow to check secret availability</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button onClick={startWorkflow} disabled={isRunning}>
                {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {isRunning ? "Running..." : "Run Workflow"}
              </Button>

              {runId && (
                <p className="text-xs text-muted-foreground">
                  Run: <code className="bg-muted px-1 rounded">{runId}</code>
                </p>
              )}

              <ErrorAlert message={error} />

              {/* Results */}
              {result && (
                <div className="space-y-3 p-4 border rounded-lg">
                  <h4 className="text-sm font-medium">Secret Check Results</h4>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <code className="text-sm">DEMO_API_KEY</code>
                      <div className="flex items-center gap-2">
                        <Badge variant={result.apiKeyPresent ? "default" : "secondary"}>
                          {result.apiKeyPresent ? "Found" : "Not Set"}
                        </Badge>
                        {result.apiKeyPresent && (
                          <code className="text-xs bg-muted px-2 py-1 rounded">{result.apiKeyPreview}</code>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <code className="text-sm">DEMO_WEBHOOK_URL</code>
                      <div className="flex items-center gap-2">
                        <Badge variant={result.webhookUrlPresent ? "default" : "secondary"}>
                          {result.webhookUrlPresent ? "Found" : "Not Set"}
                        </Badge>
                        {result.webhookUrlPresent && (
                          <code className="text-xs bg-muted px-2 py-1 rounded">{result.webhookUrlPreview}</code>
                        )}
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Checked at {result.checkedAt}
                  </p>
                  {(!result.apiKeyPresent || !result.webhookUrlPresent) && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      Some secrets are not configured. Set them on the Ironflow server to see masked values.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: System Events */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              System Events
              <Badge variant="secondary">{systemEvents.length}</Badge>
            </CardTitle>
            <CardDescription>Raw events from the workflow run</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-[600px] overflow-y-auto">
              {systemEvents.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-8">
                  {isRunning ? "Waiting for events..." : "Run the workflow to see events here."}
                </p>
              ) : (
                systemEvents.map((event) => (
                  <div key={event.id} className="border rounded-lg p-3 space-y-2 animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <Badge variant="outline">{event.type}</Badge>
                      <span className="text-xs text-muted-foreground">{event.timestamp.toLocaleTimeString()}</span>
                    </div>
                    <code className="text-xs text-muted-foreground block truncate">{event.topic}</code>
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
