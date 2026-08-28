"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ironflow } from "@ironflow/browser";
import type { ConfigWatchEvent, Subscription } from "@ironflow/browser";
import { Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ErrorAlert } from "@/components/error-alert";

interface WatchEventEntry {
  id: number;
  config: ConfigWatchEvent;
  receivedAt: Date;
}

export default function ConfigWatchPage() {
  const [watchName, setWatchName] = useState("");
  const [watching, setWatching] = useState(false);
  const [watchError, setWatchError] = useState<string | null>(null);
  const [events, setEvents] = useState<WatchEventEntry[]>([]);
  const subscriptionRef = useRef<Subscription | null>(null);
  const nextIdRef = useRef(1);

  useEffect(() => () => subscriptionRef.current?.unsubscribe(), []);

  const startWatching = useCallback(async () => {
    setWatchError(null);
    if (!watchName.trim()) {
      setWatchError("Config name is required.");
      return;
    }
    try {
      subscriptionRef.current = await ironflow.configManager().watch(watchName.trim(), {
        onUpdate: (config) => {
          const id = nextIdRef.current++;
          setEvents((current) => [{ id, config, receivedAt: new Date() }, ...current].slice(0, 100));
        },
        onError: (error) => {
          setWatchError(error.message);
          setWatching(false);
          subscriptionRef.current = null;
        },
      });
      setWatching(true);
    } catch (err) {
      setWatchError(err instanceof Error ? err.message : "Failed to start watching");
    }
  }, [watchName]);

  const stopWatching = useCallback(() => {
    subscriptionRef.current?.unsubscribe();
    subscriptionRef.current = null;
    setWatching(false);
  }, []);

  return (
    <div className="container mx-auto py-8 px-4">
      <section className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Config Watch</h1>
        <p className="text-muted-foreground">
          Subscribe to config changes made through a trusted SDK, the CLI,
          dashboard, or REST API.
        </p>
      </section>

      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex items-end gap-4 flex-wrap">
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <Label htmlFor="watch-name" className="whitespace-nowrap">Config Name:</Label>
              <Input id="watch-name" value={watchName} onChange={(event) => setWatchName(event.target.value)} placeholder="e.g., app-settings" disabled={watching} />
            </div>
            <Button variant={watching ? "destructive" : "default"} onClick={watching ? stopWatching : () => void startWatching()}>
              {watching ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {watching ? "Stop" : "Start Watching"}
            </Button>
          </div>
          <ErrorAlert message={watchError} className="mt-3" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Watch Events</CardTitle>
              <CardDescription>
                {events.length} event{events.length !== 1 ? "s" : ""} received
                {watching && <Badge variant="default" className="ml-2 animate-pulse">Live</Badge>}
              </CardDescription>
            </div>
            {events.length > 0 && <Button variant="ghost" size="sm" onClick={() => setEvents([])}>Clear</Button>}
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {events.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-8">
                {watching ? "Watching for changes..." : "Start watching to receive config notifications."}
              </p>
            ) : events.map((entry) => (
              <div key={entry.id} className="border rounded-lg p-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="default">updated</Badge>
                    <code className="font-mono text-sm">{entry.config.name}</code>
                    <span className="text-xs text-muted-foreground">rev {entry.config.revision}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{entry.receivedAt.toLocaleTimeString()}</span>
                </div>
                {entry.config.data && <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">{JSON.stringify(entry.config.data, null, 2)}</pre>}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
