"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { ironflow } from "@ironflow/browser";
import type { KVBucketInfo, KVWatchEvent, KVWatcher } from "@ironflow/browser";
import { Play, Square, Trash2, RefreshCw } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorAlert } from "@/components/error-alert";

interface WatchEventEntry {
  id: number;
  event: KVWatchEvent;
  receivedAt: Date;
}

export default function WatchPage() {
  // Bucket selection
  const [buckets, setBuckets] = useState<KVBucketInfo[]>([]);
  const [selectedBucket, setSelectedBucket] = useState("");
  const [bucketsLoaded, setBucketsLoaded] = useState(false);

  // Watch config
  const [keyPattern, setKeyPattern] = useState(">");
  const [watching, setWatching] = useState(false);
  const [watchError, setWatchError] = useState<string | null>(null);
  const watcherRef = useRef<KVWatcher | null>(null);

  // Watch events
  const [events, setEvents] = useState<WatchEventEntry[]>([]);
  const nextIdRef = useRef(1);

  // Cleanup watcher on unmount
  useEffect(() => {
    return () => {
      watcherRef.current?.stop();
    };
  }, []);

  // Make changes
  const [changeKey, setChangeKey] = useState("");
  const [changeValue, setChangeValue] = useState('{\n  "hello": "world"\n}');
  const [changeLoading, setChangeLoading] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);

  const loadBuckets = useCallback(async () => {
    if (!ironflow.isConfigured) return;
    try {
      const result = await ironflow.kv().listBuckets();
      setBuckets(result);
      setBucketsLoaded(true);
    } catch {
      // Silently fail
    }
  }, []);

  const startWatching = () => {
    setWatchError(null);
    if (!selectedBucket) {
      setWatchError("Select a bucket first.");
      return;
    }
    if (!ironflow.isConfigured) {
      setWatchError("Client not configured. Please wait for connection.");
      return;
    }

    const watcher = ironflow.kv().bucket(selectedBucket).watch(
      {
        onUpdate: (event) => {
          const id = nextIdRef.current++;
          setEvents((prev) => [{ id, event, receivedAt: new Date() }, ...prev].slice(0, 100));
        },
        onError: (err) => {
          setWatchError(err.message);
          setWatching(false);
          watcherRef.current = null;
        },
        onClose: () => {
          setWatching(false);
          watcherRef.current = null;
        },
      },
      keyPattern.trim() ? { key: keyPattern.trim() } : undefined
    );

    watcherRef.current = watcher;
    setWatching(true);
  };

  const stopWatching = () => {
    watcherRef.current?.stop();
    watcherRef.current = null;
    setWatching(false);
  };

  const handlePut = async () => {
    setChangeError(null);
    if (!selectedBucket) { setChangeError("Select a bucket first."); return; }
    if (!changeKey.trim()) { setChangeError("Key is required."); return; }
    let parsed: unknown;
    try { parsed = JSON.parse(changeValue); } catch { setChangeError("Invalid JSON."); return; }

    setChangeLoading(true);
    try {
      await ironflow.kv().bucket(selectedBucket).put(changeKey.trim(), parsed);
    } catch (err) {
      setChangeError(err instanceof Error ? err.message : "Failed");
    } finally {
      setChangeLoading(false);
    }
  };

  const handleDeleteKey = async () => {
    setChangeError(null);
    if (!selectedBucket) { setChangeError("Select a bucket first."); return; }
    if (!changeKey.trim()) { setChangeError("Key is required."); return; }

    setChangeLoading(true);
    try {
      await ironflow.kv().bucket(selectedBucket).delete(changeKey.trim());
    } catch (err) {
      setChangeError(err instanceof Error ? err.message : "Failed");
    } finally {
      setChangeLoading(false);
    }
  };

  // Auto-load buckets on mount
  useEffect(() => {
    if (!bucketsLoaded && ironflow.isConfigured) {
      loadBuckets();
    }
  }, [bucketsLoaded, loadBuckets]);

  return (
    <div className="container mx-auto py-8 px-4">
      <section className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">KV Watch</h1>
        <p className="text-muted-foreground">
          Subscribe to real-time key change notifications via WebSocket. Make
          changes and see watch events fire instantly.
        </p>
      </section>

      {/* Watch Config Bar */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex items-end gap-4 flex-wrap">
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <Label htmlFor="watch-bucket" className="whitespace-nowrap">Bucket:</Label>
              {buckets.length > 0 ? (
                <Select value={selectedBucket} onValueChange={setSelectedBucket} disabled={watching}>
                  <SelectTrigger id="watch-bucket">
                    <SelectValue placeholder="Select a bucket" />
                  </SelectTrigger>
                  <SelectContent>
                    {buckets.map((b) => (
                      <SelectItem key={b.name} value={b.name}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="watch-bucket"
                  value={selectedBucket}
                  onChange={(e) => setSelectedBucket(e.target.value)}
                  placeholder="Bucket name"
                  disabled={watching}
                />
              )}
            </div>
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <Label htmlFor="watch-pattern" className="whitespace-nowrap">Key Pattern:</Label>
              <Input
                id="watch-pattern"
                value={keyPattern}
                onChange={(e) => setKeyPattern(e.target.value)}
                placeholder="> (all keys)"
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
            <Button variant="outline" size="sm" onClick={loadBuckets} disabled={watching}>
              <RefreshCw className="h-4 w-4" />
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
              Put or delete keys to trigger watch events
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="changeKey">Key</Label>
              <Input
                id="changeKey"
                value={changeKey}
                onChange={(e) => setChangeKey(e.target.value)}
                placeholder="e.g., user.alice"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="changeValue">Value (JSON)</Label>
              <Textarea
                id="changeValue"
                value={changeValue}
                onChange={(e) => setChangeValue(e.target.value)}
                className="font-mono text-sm"
                rows={4}
              />
            </div>
            <ErrorAlert message={changeError} />
            <div className="flex gap-2">
              <Button
                onClick={handlePut}
                disabled={changeLoading || !selectedBucket}
                className="flex-1"
              >
                {changeLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
                Put
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteKey}
                disabled={changeLoading || !selectedBucket}
              >
                <Trash2 className="h-4 w-4" />
                Delete
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
                <Button variant="ghost" size="sm" onClick={() => setEvents([])}>
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
                    : "Start watching to receive real-time key change notifications."}
                </p>
              ) : (
                events.map((entry) => (
                  <div
                    key={entry.id}
                    className="border rounded-lg p-3 space-y-1 animate-in fade-in slide-in-from-top-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={entry.event.operation === "put" ? "default" : "destructive"}
                        >
                          {entry.event.operation}
                        </Badge>
                        <code className="font-mono text-sm">{entry.event.key}</code>
                        <span className="text-xs text-muted-foreground">
                          rev {entry.event.revision}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {entry.receivedAt.toLocaleTimeString()}
                      </span>
                    </div>
                    {entry.event.value && entry.event.operation === "put" && (
                      <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
                        {(() => {
                          try {
                            return JSON.stringify(JSON.parse(entry.event.value), null, 2);
                          } catch {
                            return entry.event.value;
                          }
                        })()}
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
