"use client";

import { useState } from "react";
import { ironflow } from "@ironflow/browser";
import { Check, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ErrorAlert } from "@/components/error-alert";

interface PublishResult {
  eventId?: string;
  sequence?: number;
  error?: string;
}

export default function PublishPage() {
  // Direct publish state
  const [topic, setTopic] = useState("demo.notifications");
  const [payload, setPayload] = useState('{\n  "message": "Hello from pub/sub!",\n  "priority": "normal"\n}');
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Workflow publish state
  const [wfTopic, setWfTopic] = useState("demo.notifications");
  const [wfMessage, setWfMessage] = useState("Published from workflow step");
  const [isWfPublishing, setIsWfPublishing] = useState(false);
  const [wfResult, setWfResult] = useState<string | null>(null);
  const [wfError, setWfError] = useState<string | null>(null);

  const publishDirect = async () => {
    setIsPublishing(true);
    setError(null);
    setPublishResult(null);

    try {
      const data = JSON.parse(payload);
      const response = await fetch("/api/pubsub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, data }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Failed to publish");
      }
      setPublishResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to publish");
    } finally {
      setIsPublishing(false);
    }
  };

  const publishViaWorkflow = async () => {
    setIsWfPublishing(true);
    setWfError(null);
    setWfResult(null);

    try {
      const result = await ironflow.invoke("demo.pubsub-workflow", {
        data: { topic: wfTopic, message: wfMessage },
      });
      if (result.runIds.length > 0) {
        setWfResult(result.runIds[0]);
      }
    } catch (err) {
      setWfError(err instanceof Error ? err.message : "Failed to trigger workflow");
    } finally {
      setIsWfPublishing(false);
    }
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <section className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Publish Messages</h1>
        <p className="text-muted-foreground">
          Publish messages to developer pub/sub topics. Use direct publish for immediate
          delivery or workflow publish for durable, step-tracked publishing.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Direct Publish */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Direct Publish
              <Badge variant="outline" className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                Server-side
              </Badge>
            </CardTitle>
            <CardDescription>
              Publish immediately via <code>client.publish()</code> through the API route
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="topic">Topic</Label>
              <Input
                id="topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g., demo.notifications, orders.created"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="payload">Data (JSON)</Label>
              <Textarea
                id="payload"
                value={payload}
                onChange={(e) => setPayload(e.target.value)}
                className="font-mono text-sm"
                rows={5}
              />
            </div>

            <Button onClick={publishDirect} disabled={isPublishing || !topic.trim()}>
              {isPublishing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {isPublishing ? "Publishing..." : "Publish"}
            </Button>

            <ErrorAlert message={error} />

            {publishResult && (
              <div className="p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg space-y-1">
                <div className="flex items-center gap-2 text-green-700 dark:text-green-300">
                  <Check className="h-4 w-4" />
                  <span className="text-sm font-medium">Published successfully</span>
                </div>
                <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
                  {JSON.stringify(publishResult, null, 2)}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Workflow Publish */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Workflow Publish
              <Badge variant="outline" className="bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
                step.publish()
              </Badge>
            </CardTitle>
            <CardDescription>
              Publish from within a durable workflow step via <code>step.publish()</code>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="wf-topic">Topic</Label>
              <Input
                id="wf-topic"
                value={wfTopic}
                onChange={(e) => setWfTopic(e.target.value)}
                placeholder="e.g., demo.notifications"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="wf-message">Message</Label>
              <Input
                id="wf-message"
                value={wfMessage}
                onChange={(e) => setWfMessage(e.target.value)}
                placeholder="Message to publish"
              />
            </div>

            <Button onClick={publishViaWorkflow} disabled={isWfPublishing || !wfTopic.trim()}>
              {isWfPublishing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {isWfPublishing ? "Triggering..." : "Publish via Workflow"}
            </Button>

            <ErrorAlert message={wfError} />

            {wfResult && (
              <div className="p-3 bg-purple-50 dark:bg-purple-950 border border-purple-200 dark:border-purple-800 rounded-lg space-y-1">
                <div className="flex items-center gap-2 text-purple-700 dark:text-purple-300">
                  <Check className="h-4 w-4" />
                  <span className="text-sm font-medium">Workflow triggered</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Run ID: <code className="bg-muted px-1 rounded">{wfResult}</code>
                </p>
                <p className="text-xs text-muted-foreground">
                  The workflow will execute <code>step.publish()</code> to publish the message durably.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
