"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { ironflow } from "@ironflow/browser";
import type { ConfigWatchEvent, Subscription } from "@ironflow/browser";
import { Play, Square, RefreshCw } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { ErrorAlert } from "@/components/error-alert";

interface WatchEventEntry {
  id: number;
  config: ConfigWatchEvent;
  receivedAt: Date;
}

export default function ConfigWatchPage() {
  // Watch config
  const [watchName, setWatchName] = useState("");
  const [watching, setWatching] = useState(false);
  const [watchError, setWatchError] = useState<string | null>(null);
  const subscriptionRef = useRef<Subscription | null>(null);

  // Watch events
  const [events, setEvents] = useState<WatchEventEntry[]>([]);
  const nextIdRef = useRef(1);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      subscriptionRef.current?.unsubscribe();
    };
  }, []);

  // Make changes
  const [changeName, setChangeName] = useState("");
  const [changeData, setChangeData] = useState('{\n  "key": "value"\n}');
  const [changeLoading, setChangeLoading] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);

  const startWatching = useCallback(async () => {
    setWatchError(null);
    if (!watchName.trim()) {
      setWatchError("Config name is required.");
      return;
    }
    if (!ironflow.isConfigured) {
      setWatchError("Client not configured. Please wait for connection.");
      return;
    }

    try {
      const sub = await ironflow.configManager().watch(watchName.trim(), {
        onUpdate: (config: ConfigWatchEvent) => {
          const id = nextIdRef.current++;
          setEvents((prev) =>
            [{ id, config, receivedAt: new Date() }, ...prev].slice(0, 100)
          );
        },
        onError: (err: Error) => {
          setWatchError(err.message);
          setWatching(false);
          subscriptionRef.current = null;
        },
      });

      subscriptionRef.current = sub;
      setWatching(true);
    } catch (err) {
      setWatchError(
        err instanceof Error ? err.message : "Failed to start watching"
      );
    }
  }, [watchName]);

  const stopWatching = useCallback(() => {
    subscriptionRef.current?.unsubscribe();
    subscriptionRef.current = null;
    setWatching(false);
  }, []);

  const handleSet = async () => {
    setChangeError(null);
    if (!changeName.trim()) {
      setChangeError("Config name is required.");
      return;
    }
    let parsed: Record<string, unknown>;
    try {
      const result = JSON.parse(changeData);
      if (typeof result !== "object" || result === null || Array.isArray(result)) {
        setChangeError("JSON data must be a valid object.");
        return;
      }
      parsed = result as Record<string, unknown>;
    } catch {
      setChangeError("Invalid JSON.");
      return;
    }

    setChangeLoading(true);
    try {
      await ironflow.configManager().set(changeName.trim(), parsed);
    } catch (err) {
      setChangeError(err instanceof Error ? err.message : "Failed to set config");
    } finally {
      setChangeLoading(false);
    }
  };

  const handlePatch = async () => {
    setChangeError(null);
    if (!changeName.trim()) {
      setChangeError("Config name is required.");
      return;
    }
    let parsed: Record<string, unknown>;
    try {
      const result = JSON.parse(changeData);
      if (typeof result !== "object" || result === null || Array.isArray(result)) {
        setChangeError("JSON data must be a valid object.");
        return;
      }
      parsed = result as Record<string, unknown>;
    } catch {
      setChangeError("Invalid JSON.");
      return;
    }

    setChangeLoading(true);
    try {
      await ironflow.configManager().patch(changeName.trim(), parsed);
    } catch (err) {
      setChangeError(
        err instanceof Error ? err.message : "Failed to patch config"
      );
    } finally {
      setChangeLoading(false);
    }
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <section className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">
          Config Watch
        </h1>
        <p className="text-muted-foreground">
          Subscribe to real-time config change notifications via WebSocket. Make
          changes and see watch events fire instantly.
        </p>
      </section>

      {/* Watch Config Bar */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex items-end gap-4 flex-wrap">
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <Label htmlFor="watch-name" className="whitespace-nowrap">
                Config Name:
              </Label>
              <Input
                id="watch-name"
                value={watchName}
                onChange={(e) => setWatchName(e.target.value)}
                placeholder="e.g., app-settings"
                disabled={watching}
              />
            </div>
            <Button
              variant={watching ? "destructive" : "default"}
              onClick={watching ? stopWatching : startWatching}
            >
              {watching ? (
                <>
                  <Square className="h-4 w-4" />
                  Stop
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  Start Watching
                </>
              )}
            </Button>
          </div>
          <ErrorAlert message={watchError} className="mt-3" />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: Make Changes (1 col) */}
        <Card>
          <CardHeader>
            <CardTitle>Make Changes</CardTitle>
            <CardDescription>
              Set or patch configs to trigger watch events
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="changeName">Config Name</Label>
              <Input
                id="changeName"
                value={changeName}
                onChange={(e) => setChangeName(e.target.value)}
                placeholder="e.g., app-settings"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="changeData">JSON Data</Label>
              <Textarea
                id="changeData"
                value={changeData}
                onChange={(e) => setChangeData(e.target.value)}
                className="font-mono text-sm"
                rows={4}
              />
            </div>
            <ErrorAlert message={changeError} />
            <div className="flex gap-2">
              <Button
                onClick={handleSet}
                disabled={changeLoading}
                className="flex-1"
              >
                {changeLoading ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : null}
                Set
              </Button>
              <Button
                variant="secondary"
                onClick={handlePatch}
                disabled={changeLoading}
                className="flex-1"
              >
                {changeLoading ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : null}
                Patch
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Right: Watch Events (2 cols) */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Watch Events</CardTitle>
                <CardDescription>
                  {events.length} event{events.length !== 1 ? "s" : ""} received
                  {watching && (
                    <Badge variant="default" className="ml-2 animate-pulse">
                      Live
                    </Badge>
                  )}
                </CardDescription>
              </div>
              {events.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEvents([])}
                >
                  Clear
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {events.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-8">
                  {watching
                    ? "Watching for changes... Make a change to see events appear."
                    : "Start watching to receive real-time config change notifications."}
                </p>
              ) : (
                events.map((entry) => (
                  <div
                    key={entry.id}
                    className="border rounded-lg p-3 space-y-1 animate-in fade-in slide-in-from-top-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="default">updated</Badge>
                        <code className="font-mono text-sm">
                          {entry.config.name}
                        </code>
                        <span className="text-xs text-muted-foreground">
                          rev {entry.config.revision}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {entry.receivedAt.toLocaleTimeString()}
                      </span>
                    </div>
                    {entry.config.data && (
                      <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
                        {JSON.stringify(entry.config.data, null, 2)}
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
