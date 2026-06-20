"use client";

import { MessageSquare, Info } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function TopicsPage() {
  return (
    <div className="container mx-auto py-8 px-4">
      <section className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Pub/Sub Topics</h1>
        <p className="text-muted-foreground mb-4">
          Developer pub/sub provides first-class topic-based messaging. Topics are created
          automatically on first publish.
        </p>
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Pub/Sub topics are separate from Ironflow system events. They provide a simple
            publish/subscribe model for application-level messaging.
          </AlertDescription>
        </Alert>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              How Topics Work
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <Badge variant="outline" className="mt-0.5">1</Badge>
                <div>
                  <p className="text-sm font-medium">Publish to a topic</p>
                  <p className="text-sm text-muted-foreground">
                    Use <code>client.publish(topic, data)</code> from server-side code
                    or <code>step.publish(topic, data)</code> from within a workflow.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Badge variant="outline" className="mt-0.5">2</Badge>
                <div>
                  <p className="text-sm font-medium">Subscribe with patterns</p>
                  <p className="text-sm text-muted-foreground">
                    Use <code>ironflow.subscribe(pattern, callbacks)</code> with wildcards
                    like <code>orders.&gt;</code> or <code>demo.*</code>.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Badge variant="outline" className="mt-0.5">3</Badge>
                <div>
                  <p className="text-sm font-medium">Replay messages</p>
                  <p className="text-sm text-muted-foreground">
                    Subscribers can replay the last N messages when connecting with
                    the <code>replay</code> option.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Publishing Methods</CardTitle>
            <CardDescription>Three ways to publish messages</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="p-3 border rounded-lg">
                <Badge variant="outline" className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 mb-2">
                  Server-side
                </Badge>
                <pre className="text-xs bg-muted p-2 rounded">{`const client = createClient({ serverUrl })\nawait client.publish("orders.created", { orderId: "123" })`}</pre>
              </div>
              <div className="p-3 border rounded-lg">
                <Badge variant="outline" className="bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 mb-2">
                  From workflow step
                </Badge>
                <pre className="text-xs bg-muted p-2 rounded">{`await step.publish("notifications.sent", {\n  message: "Order confirmed"\n})`}</pre>
              </div>
              <div className="p-3 border rounded-lg">
                <Badge variant="outline" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 mb-2">
                  Pattern matching
                </Badge>
                <pre className="text-xs bg-muted p-2 rounded">{`// Subscribe to all order events\nironflow.subscribe("orders.>", { onEvent })\n\n// Subscribe to specific events\nironflow.subscribe("orders.created", { onEvent })`}</pre>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
