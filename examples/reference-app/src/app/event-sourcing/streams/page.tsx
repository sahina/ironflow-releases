"use client";

import { useRef, useState } from "react";
import {
  ironflow,
  type StreamEvent,
  type StreamInfo,
  type SubscriptionEvent,
} from "@ironflow/browser";
import { useSystemSubscription } from "@/hooks/use-system-subscription";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
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

const EVENT_PRESETS: Record<string, string> = {
  "account.opened": '{\n  "owner": "Alice"\n}',
  "money.deposited": '{\n  "amount": 100\n}',
  "money.withdrawn": '{\n  "amount": 25\n}',
};

const EVENT_NAMES = Object.keys(EVENT_PRESETS);

interface StreamActivity {
  key: string;
  entityId: string;
  entityType: string;
  entityVersion: number;
  eventName: string;
  timestamp: Date;
}

export default function StreamsPage() {
  // Append form state
  const [entityId, setEntityId] = useState("account-001");
  const [selectedEvent, setSelectedEvent] = useState(EVENT_NAMES[0]);
  const [dataJson, setDataJson] = useState(EVENT_PRESETS[EVENT_NAMES[0]]);
  const [expectedVersion, setExpectedVersion] = useState("");
  const [appending, setAppending] = useState(false);
  const [appendError, setAppendError] = useState<string | null>(null);
  const [appendResult, setAppendResult] = useState<{
    eventId: string;
    entityVersion: number;
  } | null>(null);

  // Stream state
  const [streamInfo, setStreamInfo] = useState<StreamInfo | null>(null);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);

  // Live activity from system.stream.{entity_id}.appended frames (#1730). This
  // is the operator view: the frames carry no event body, so the feed shows
  // what changed and at which version, and "Load Stream" remains the way to
  // see the data.
  const [activity, setActivity] = useState<StreamActivity[]>([]);
  // Monotonic, because the list is capped at 20 and an index would repeat.
  const activitySeq = useRef(0);

  useSystemSubscription("system.stream.>", (event: SubscriptionEvent) => {
    // Route on the TRAILING segment, not on parts[2]. An entity ID may contain
    // ".", so the ID spans a variable number of segments and parts[2] would
    // read as a different entity — the payload's entity_id is the
    // authoritative key. Unknown verbs are passed over rather than rendered,
    // so a future one added to the family does not show up as a blank row.
    const parts = event.topic.split(".");
    if (parts[parts.length - 1] !== "appended") return;

    const data = event.data as {
      entity_id?: string;
      entity_type?: string;
      entity_version?: number;
      event_name?: string;
    };
    const entityId = data.entity_id;
    if (!entityId) return;

    activitySeq.current += 1;
    const key = `${event.topic}-${activitySeq.current}`;

    setActivity((prev) =>
      [
        {
          key,
          entityId,
          entityType: data.entity_type ?? "",
          entityVersion: data.entity_version ?? 0,
          eventName: data.event_name ?? "",
          timestamp: new Date(),
        },
        ...prev,
      ].slice(0, 20)
    );
  });

  const handleEventSelect = (name: string) => {
    setSelectedEvent(name);
    setDataJson(EVENT_PRESETS[name]);
  };

  const handleAppend = async () => {
    setAppendError(null);
    setAppendResult(null);

    if (!ironflow.isConfigured) {
      setAppendError("Client not configured. Please wait for connection.");
      return;
    }

    let parsedData: Record<string, unknown>;
    try {
      parsedData = JSON.parse(dataJson);
    } catch {
      setAppendError("Invalid JSON in data field.");
      return;
    }

    setAppending(true);
    try {
      const options =
        expectedVersion !== ""
          ? { expectedVersion: parseInt(expectedVersion, 10) }
          : undefined;

      const result = await ironflow.streams.append(
        entityId,
        {
          name: selectedEvent,
          data: parsedData,
          entityType: "bank-account",
        },
        options
      );

      setAppendResult({
        eventId: result.eventId,
        entityVersion: result.entityVersion,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to append event";
      setAppendError(message);
    } finally {
      setAppending(false);
    }
  };

  const handleLoadStream = async () => {
    setStreamError(null);

    if (!ironflow.isConfigured) {
      setStreamError("Client not configured. Please wait for connection.");
      return;
    }

    setLoading(true);
    try {
      const [readResult, info] = await Promise.all([
        ironflow.streams.read(entityId),
        ironflow.streams.getInfo(entityId),
      ]);

      setEvents(readResult.events);
      setStreamInfo(info);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load stream";
      setStreamError(message);
    } finally {
      setLoading(false);
    }
  };

  const clearStream = () => {
    setEvents([]);
    setStreamInfo(null);
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <section className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">
          Entity Streams
        </h1>
        <p className="text-muted-foreground">
          Append events to entity streams and read them back. Entity streams
          provide ordered, versioned event storage with optimistic concurrency
          control.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left Column: Append Event */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Append Event</CardTitle>
              <CardDescription>
                Append a new event to an entity stream
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
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="entityType">Entity Type</Label>
                <Input
                  id="entityType"
                  value="bank-account"
                  readOnly
                  className="bg-muted"
                />
              </div>

              <div className="space-y-2">
                <Label>Event Name</Label>
                <div className="flex gap-2">
                  {EVENT_NAMES.map((name) => (
                    <Button
                      key={name}
                      variant={selectedEvent === name ? "default" : "outline"}
                      size="sm"
                      onClick={() => handleEventSelect(name)}
                    >
                      {name}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="data">Data (JSON)</Label>
                <Textarea
                  id="data"
                  value={dataJson}
                  onChange={(e) => setDataJson(e.target.value)}
                  className="font-mono text-sm"
                  rows={4}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="expectedVersion">
                  Expected Version (optional)
                </Label>
                <Input
                  id="expectedVersion"
                  type="number"
                  value={expectedVersion}
                  onChange={(e) => setExpectedVersion(e.target.value)}
                  placeholder="Leave empty to skip concurrency check"
                />
              </div>

              <ErrorAlert message={appendError} />

              {appendResult && (
                <div className="text-sm bg-green-500/10 text-green-700 dark:text-green-400 p-3 rounded-md space-y-1">
                  <p>
                    <span className="font-medium">Event ID:</span>{" "}
                    <code className="font-mono">{appendResult.eventId}</code>
                  </p>
                  <p>
                    <span className="font-medium">Entity Version:</span>{" "}
                    {appendResult.entityVersion}
                  </p>
                </div>
              )}

              <Button
                onClick={handleAppend}
                disabled={appending || !entityId.trim()}
                className="w-full"
              >
                {appending ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Appending...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" />
                    Append Event
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Live Activity</CardTitle>
                  <CardDescription>
                    Every append in this environment, from{" "}
                    <code className="font-mono text-xs">system.stream.&gt;</code>
                  </CardDescription>
                </div>
                {activity.length > 0 && (
                  <Button variant="outline" size="sm" onClick={() => setActivity([])}>
                    <Trash2 className="h-4 w-4" />
                    Clear
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-[280px] overflow-y-auto">
                {activity.length === 0 ? (
                  <p className="text-muted-foreground text-sm text-center py-8">
                    No activity yet. Append an event — from this page, the CLI or an
                    SDK — and it appears here without a refresh.
                  </p>
                ) : (
                  activity.map((item) => (
                    <div
                      key={item.key}
                      className="flex items-center justify-between gap-2 border rounded-lg p-2 text-sm animate-in fade-in slide-in-from-top-2"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge variant="secondary">appended</Badge>
                        <code className="font-mono text-xs truncate">
                          {item.entityId}
                        </code>
                        {item.entityType && (
                          <span className="text-xs text-muted-foreground">
                            {item.entityType}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          v{item.entityVersion}
                        </span>
                        {item.eventName && (
                          <span className="text-xs text-muted-foreground truncate">
                            {item.eventName}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {item.timestamp.toLocaleTimeString()}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Stream */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Stream</CardTitle>
                <CardDescription>
                  Events stored in the entity stream
                </CardDescription>
              </div>
              <div className="flex gap-2">
                {events.length > 0 && (
                  <Button variant="outline" size="sm" onClick={clearStream}>
                    <Trash2 className="h-4 w-4" />
                    Clear
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLoadStream}
                  disabled={loading || !entityId.trim()}
                >
                  <RefreshCw
                    className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
                  />
                  Load Stream
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ErrorAlert message={streamError} />

            {streamInfo && (
              <div className="bg-muted rounded-md p-3 mb-4 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Entity ID:</span>
                  <code className="font-mono">{streamInfo.entityId}</code>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Type:</span>
                  <span>{streamInfo.entityType}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Version:</span>
                  <span>{streamInfo.version}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Event Count:</span>
                  <span>{streamInfo.eventCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Created:</span>
                  <span>
                    {new Date(streamInfo.createdAt).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Updated:</span>
                  <span>
                    {new Date(streamInfo.updatedAt).toLocaleString()}
                  </span>
                </div>
              </div>
            )}

            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              {events.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-8">
                  No events loaded. Click &quot;Load Stream&quot; to read events
                  from the entity stream.
                </p>
              ) : (
                events.map((event) => (
                  <div
                    key={event.id}
                    className="border rounded-lg p-3 space-y-2 animate-in fade-in slide-in-from-top-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{event.name}</Badge>
                        <span className="text-xs text-muted-foreground">
                          v{event.entityVersion}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {new Date(event.timestamp).toLocaleTimeString()}
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
