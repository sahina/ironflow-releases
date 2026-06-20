"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { ironflow, type Subscription, type SubscriptionEvent } from "@ironflow/browser";
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
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  Info,
  Minus,
  Plus,
  Send,
  Users,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Zap,
  ShieldCheck,
  Inbox,
  Trash2,
  RotateCcw,
} from "lucide-react";

interface Subscriber {
  id: string;
  events: Array<{ id: string; name: string; timestamp: Date }>;
  subscription: Subscription | null;
  receivedCount: number;
}

// --- Acknowledgment Tab types ---
type AckMode = "auto-ack" | "manual-ack";

interface AckMessage {
  id: string;
  name: string;
  timestamp: Date;
  status: "inflight" | "acked" | "nacked" | "termed";
  redeliveryCount: number;
  redeliveryTimer?: ReturnType<typeof setTimeout>;
}

// --- Backpressure Tab types ---
type BackpressureMode = "drop" | "block" | "buffer";

interface BpMessage {
  id: string;
  name: string;
  timestamp: Date;
  state: "delivered" | "processed" | "dropped" | "queued" | "blocked";
}

export default function ConsumerGroupsPage() {
  const [groupName, setGroupName] = useState("demo-group");
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [totalEmitted, setTotalEmitted] = useState(0);
  const [isEmitting, setIsEmitting] = useState(false);
  const [highlightedSubscriber, setHighlightedSubscriber] = useState<string | null>(null);

  const subscriberIdRef = useRef(0);

  // --- Acknowledgment Tab state ---
  const [ackMode, setAckMode] = useState<AckMode>("auto-ack");
  const [ackMessages, setAckMessages] = useState<AckMessage[]>([]);
  const [ackSubscription, setAckSubscription] = useState<Subscription | null>(null);
  const [nakDelay, setNakDelay] = useState(3);
  const [ackEmitCount, setAckEmitCount] = useState(0);
  const ackMessageIdRef = useRef(0);
  const ackModeRef = useRef<AckMode>(ackMode);

  // Keep ref in sync so the subscription callback sees the latest mode
  useEffect(() => {
    ackModeRef.current = ackMode;
  }, [ackMode]);

  const ackInflightCount = ackMessages.filter((m) => m.status === "inflight").length;
  const ackProcessedCount = ackMessages.filter((m) => m.status === "acked").length;
  const ackTermedCount = ackMessages.filter((m) => m.status === "termed").length;

  const startAckSubscriber = useCallback(async () => {
    if (ackSubscription) return;
    if (!ironflow.isConfigured) return;

    try {
      const sub = await ironflow.subscribe("events:ack-demo.*", {
        consumerGroup: "ack-demo-group",
        onEvent: (event: SubscriptionEvent) => {
          const msg: AckMessage = {
            id: `ack-msg-${++ackMessageIdRef.current}`,
            name: event.topic,
            timestamp: new Date(),
            status: "inflight",
            redeliveryCount: 0,
          };

          setAckMessages((prev) => {
            // In auto-ack mode, immediately mark as acked
            if (ackModeRef.current === "auto-ack") {
              return [{ ...msg, status: "acked" as const }, ...prev].slice(0, 20);
            }
            return [msg, ...prev].slice(0, 20);
          });
        },
      });
      setAckSubscription(sub);
    } catch (error) {
      console.error("Failed to start ack subscriber:", error);
    }
  }, [ackSubscription]);

  const stopAckSubscriber = useCallback(() => {
    ackSubscription?.unsubscribe();
    setAckSubscription(null);
  }, [ackSubscription]);

  const emitAckEvent = useCallback(async () => {
    try {
      await ironflow.emit(`ack-demo.event-${Date.now()}`, {
        timestamp: new Date().toISOString(),
      });
      setAckEmitCount((prev) => prev + 1);
    } catch (error) {
      console.error("Failed to emit ack event:", error);
    }
  }, []);

  const handleAck = useCallback((msgId: string) => {
    setAckMessages((prev) =>
      prev.map((m) =>
        m.id === msgId ? { ...m, status: "acked" as const } : m
      )
    );
  }, []);

  const handleNak = useCallback(
    (msgId: string) => {
      setAckMessages((prev) =>
        prev.map((m) => {
          if (m.id !== msgId) return m;
          const updated: AckMessage = {
            ...m,
            status: "nacked" as const,
            redeliveryCount: m.redeliveryCount + 1,
          };
          return updated;
        })
      );

      // Simulate redelivery after delay
      setTimeout(() => {
        setAckMessages((prev) =>
          prev.map((m) =>
            m.id === msgId && m.status === "nacked"
              ? { ...m, status: "inflight" as const }
              : m
          )
        );
      }, nakDelay * 1000);
    },
    [nakDelay]
  );

  const handleTerm = useCallback((msgId: string) => {
    setAckMessages((prev) =>
      prev.map((m) =>
        m.id === msgId ? { ...m, status: "termed" as const } : m
      )
    );
  }, []);

  // Cleanup ack subscription on unmount
  const ackSubRef = useRef(ackSubscription);
  ackSubRef.current = ackSubscription;

  useEffect(() => {
    return () => {
      ackSubRef.current?.unsubscribe();
    };
  }, []);

  // --- Backpressure Tab state ---
  const [bpMode, setBpMode] = useState<BackpressureMode>("drop");
  const [maxInflight, setMaxInflight] = useState(5);
  const [bpMessages, setBpMessages] = useState<BpMessage[]>([]);
  const [isFlooding, setIsFlooding] = useState(false);
  const [bpSubscription, setBpSubscription] = useState<Subscription | null>(null);
  const bpMessageIdRef = useRef(0);
  const bpModeRef = useRef<BackpressureMode>(bpMode);
  const maxInflightRef = useRef(maxInflight);

  // Keep refs in sync so the subscription callback sees the latest values
  useEffect(() => { bpModeRef.current = bpMode; }, [bpMode]);
  useEffect(() => { maxInflightRef.current = maxInflight; }, [maxInflight]);

  const bpDelivered = bpMessages.filter((m) => m.state === "delivered").length;
  const bpProcessed = bpMessages.filter((m) => m.state === "processed").length;
  const bpDropped = bpMessages.filter((m) => m.state === "dropped").length;
  const bpQueued = bpMessages.filter((m) => m.state === "queued").length;
  const bpBlocked = bpMessages.filter((m) => m.state === "blocked").length;

  const startBpSubscriber = useCallback(async () => {
    if (bpSubscription) return;
    if (!ironflow.isConfigured) return;

    try {
      const sub = await ironflow.subscribe("events:bp-demo.*", {
        consumerGroup: "bp-demo-group",
        onEvent: (event: SubscriptionEvent) => {
          setBpMessages((prev) => {
            const inflightCount = prev.filter(
              (m) => m.state === "delivered"
            ).length;

            const newMsg: BpMessage = {
              id: `bp-msg-${++bpMessageIdRef.current}`,
              name: event.topic,
              timestamp: new Date(),
              state: "delivered",
            };

            if (inflightCount >= maxInflightRef.current) {
              switch (bpModeRef.current) {
                case "drop":
                  return [{ ...newMsg, state: "dropped" as const }, ...prev].slice(0, 30);
                case "block":
                  return [{ ...newMsg, state: "blocked" as const }, ...prev].slice(0, 30);
                case "buffer":
                  return [{ ...newMsg, state: "queued" as const }, ...prev].slice(0, 30);
              }
            }

            return [newMsg, ...prev].slice(0, 30);
          });
        },
      });
      setBpSubscription(sub);
    } catch (error) {
      console.error("Failed to start bp subscriber:", error);
    }
  }, [bpSubscription]);

  const stopBpSubscriber = useCallback(() => {
    bpSubscription?.unsubscribe();
    setBpSubscription(null);
  }, [bpSubscription]);

  const floodEvents = useCallback(async () => {
    if (isFlooding) return;
    setIsFlooding(true);

    for (let i = 0; i < 20; i++) {
      try {
        await ironflow.emit(`bp-demo.flood-${i + 1}`, {
          index: i + 1,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        console.error("Failed to emit flood event:", error);
      }
      // Rapid-fire: 50ms between events
      if (i < 19) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    setIsFlooding(false);
  }, [isFlooding]);

  const resetBpMessages = useCallback(() => {
    setBpMessages([]);
    bpMessageIdRef.current = 0;
  }, []);

  // Simulate message processing: delivered → processed after 1.5s, freeing capacity
  useEffect(() => {
    const deliveredMessages = bpMessages.filter((m) => m.state === "delivered");
    if (deliveredMessages.length === 0) return;

    const timer = setTimeout(() => {
      setBpMessages((prev) => {
        // Process the oldest delivered message (last in array since newest are first)
        const deliveredIds = prev
          .filter((m) => m.state === "delivered")
          .map((m) => m.id);
        if (deliveredIds.length === 0) return prev;
        const oldestId = deliveredIds[deliveredIds.length - 1];
        return prev.map((m) =>
          m.id === oldestId ? { ...m, state: "processed" as const } : m
        );
      });
    }, 1500);
    return () => clearTimeout(timer);
  }, [bpMessages]);

  // Promote queued messages when inflight capacity frees up (buffer mode)
  useEffect(() => {
    if (bpMode !== "buffer") return;

    const inflightCount = bpMessages.filter((m) => m.state === "delivered").length;
    const queuedMessages = bpMessages.filter((m) => m.state === "queued");

    if (inflightCount < maxInflight && queuedMessages.length > 0) {
      const timer = setTimeout(() => {
        setBpMessages((prev) => {
          const currentInflight = prev.filter((m) => m.state === "delivered").length;
          const slotsAvailable = maxInflight - currentInflight;
          if (slotsAvailable <= 0) return prev;

          let promoted = 0;
          return prev.map((m) => {
            if (m.state === "queued" && promoted < slotsAvailable) {
              promoted++;
              return { ...m, state: "delivered" as const };
            }
            return m;
          });
        });
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [bpMessages, bpMode, maxInflight]);

  // Cleanup bp subscription on unmount
  const bpSubRef = useRef(bpSubscription);
  bpSubRef.current = bpSubscription;

  useEffect(() => {
    return () => {
      bpSubRef.current?.unsubscribe();
    };
  }, []);

  const addSubscriber = useCallback(async () => {
    if (subscribers.length >= 4) return;

    if (!ironflow.isConfigured) {
      console.error("Ironflow client not configured");
      return;
    }

    const id = `subscriber-${++subscriberIdRef.current}`;
    const newSubscriber: Subscriber = {
      id,
      events: [],
      subscription: null,
      receivedCount: 0,
    };

    setSubscribers((prev) => [...prev, newSubscriber]);

    try {
      const subscription = await ironflow.subscribe("events:demo.*", {
        consumerGroup: groupName,
        onEvent: (event: SubscriptionEvent) => {
          setSubscribers((prev) =>
            prev.map((sub) => {
              if (sub.id === id) {
                const newEvent = {
                  id: crypto.randomUUID(),
                  name: event.topic,
                  timestamp: new Date(),
                };
                return {
                  ...sub,
                  events: [newEvent, ...sub.events].slice(0, 5),
                  receivedCount: sub.receivedCount + 1,
                };
              }
              return sub;
            })
          );
          // Highlight the subscriber that received the event
          setHighlightedSubscriber(id);
          setTimeout(() => setHighlightedSubscriber(null), 300);
        },
      });

      setSubscribers((prev) =>
        prev.map((sub) =>
          sub.id === id ? { ...sub, subscription } : sub
        )
      );
    } catch (error) {
      console.error("Failed to subscribe:", error);
      // Remove the subscriber if subscription failed
      setSubscribers((prev) => prev.filter((sub) => sub.id !== id));
    }
  }, [subscribers.length, groupName]);

  const removeSubscriber = useCallback(() => {
    if (subscribers.length === 0) return;

    const lastSubscriber = subscribers[subscribers.length - 1];
    lastSubscriber.subscription?.unsubscribe();

    setSubscribers((prev) => prev.slice(0, -1));
  }, [subscribers]);

  const emitBatch = useCallback(async () => {
    if (isEmitting) return;

    setIsEmitting(true);

    for (let i = 0; i < 10; i++) {
      try {
        await ironflow.emit(`demo.event-${i + 1}`, {
          index: i + 1,
          timestamp: new Date().toISOString(),
        });
        setTotalEmitted((prev) => prev + 1);
      } catch (error) {
        console.error("Failed to emit event:", error);
      }

      // Wait 200ms between events
      if (i < 9) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    setIsEmitting(false);
  }, [isEmitting]);

  // Cleanup on unmount only - use ref to access current subscribers
  const subscribersRef = useRef(subscribers);
  subscribersRef.current = subscribers;

  useEffect(() => {
    return () => {
      subscribersRef.current.forEach((sub) => sub.subscription?.unsubscribe());
    };
  }, []); // Empty deps - only run cleanup on unmount

  const totalReceived = subscribers.reduce(
    (sum, sub) => sum + sub.receivedCount,
    0
  );

  const maxEvents = Math.max(...subscribers.map((s) => s.receivedCount), 1);

  return (
    <div className="container mx-auto py-8 px-4">
      <section className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">
          Consumer Groups
        </h1>
        <p className="text-muted-foreground mb-4">
          Visualize round-robin distribution, acknowledgment modes, and
          backpressure strategies for consumer groups.
        </p>
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Subscribers are tied to this page. Navigating away will automatically
            unsubscribe all members and clean up connections.
          </AlertDescription>
        </Alert>
      </section>

      <Tabs defaultValue="round-robin" className="w-full">
        <TabsList>
          <TabsTrigger value="round-robin">
            <Users className="mr-1.5 h-4 w-4" />
            Round-Robin
          </TabsTrigger>
          <TabsTrigger value="acknowledgment">
            <ShieldCheck className="mr-1.5 h-4 w-4" />
            Acknowledgment
          </TabsTrigger>
          <TabsTrigger value="backpressure">
            <Zap className="mr-1.5 h-4 w-4" />
            Backpressure
          </TabsTrigger>
        </TabsList>

        {/* ==================== Round-Robin Tab ==================== */}
        <TabsContent value="round-robin">
          {/* Control Panel */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Control Panel
              </CardTitle>
              <CardDescription>
                Manage subscribers and emit events to see load balancing in action
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="flex-1">
                  <Label htmlFor="group-name">Group Name</Label>
                  <Input
                    id="group-name"
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    disabled={subscribers.length > 0}
                    placeholder="Enter group name"
                    className="mt-1"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={addSubscriber}
                  disabled={subscribers.length >= 4}
                  variant="outline"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Subscriber
                </Button>
                <Button
                  onClick={removeSubscriber}
                  disabled={subscribers.length === 0}
                  variant="outline"
                >
                  <Minus className="mr-2 h-4 w-4" />
                  Remove Subscriber
                </Button>
                <Button
                  onClick={emitBatch}
                  disabled={isEmitting || subscribers.length === 0}
                >
                  <Send className="mr-2 h-4 w-4" />
                  {isEmitting ? "Emitting..." : "Emit 10 Events"}
                </Button>
              </div>

              <div className="text-sm text-muted-foreground">
                {subscribers.length} subscriber(s) in group{" "}
                <Badge variant="secondary">{groupName}</Badge>
              </div>
            </CardContent>
          </Card>

          {/* Subscriber Panels */}
          {subscribers.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
              {subscribers.map((subscriber) => (
                <Card
                  key={subscriber.id}
                  className={`transition-all duration-300 ${
                    highlightedSubscriber === subscriber.id
                      ? "ring-2 ring-primary shadow-lg"
                      : ""
                  }`}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{subscriber.id}</CardTitle>
                      <Badge variant="outline">{subscriber.receivedCount}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-1 min-h-[100px]">
                      {subscriber.receivedCount === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          No events received yet
                        </p>
                      ) : (
                        subscriber.events.map((event) => (
                          <div
                            key={event.id}
                            className="text-xs py-1 px-2 bg-muted rounded flex justify-between"
                          >
                            <span className="truncate flex-1">{event.name}</span>
                            <span className="text-muted-foreground ml-2">
                              {event.timestamp.toLocaleTimeString()}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                    <Progress
                      value={(subscriber.receivedCount / maxEvents) * 100}
                      className="h-2"
                    />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Summary Card */}
          {subscribers.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Distribution Summary</CardTitle>
                <CardDescription>
                  Overview of event distribution across all subscribers
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Total Emitted</p>
                    <p className="text-2xl font-bold">{totalEmitted}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Total Received</p>
                    <p className="text-2xl font-bold">{totalReceived}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  {subscribers.map((subscriber) => (
                    <div key={subscriber.id} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span>{subscriber.id}</span>
                        <span className="text-muted-foreground">
                          {subscriber.receivedCount} events (
                          {totalReceived > 0
                            ? Math.round(
                                (subscriber.receivedCount / totalReceived) * 100
                              )
                            : 0}
                          %)
                        </span>
                      </div>
                      <Progress
                        value={
                          totalReceived > 0
                            ? (subscriber.receivedCount / totalReceived) * 100
                            : 0
                        }
                        className="h-2"
                      />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Empty State */}
          {subscribers.length === 0 && (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center">
                <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No Subscribers Yet</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Add subscribers to the consumer group to see round-robin event
                  distribution in action.
                </p>
                <Button onClick={addSubscriber}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add First Subscriber
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ==================== Acknowledgment Tab ==================== */}
        <TabsContent value="acknowledgment">
          {/* Ack Mode Control */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5" />
                Acknowledgment Modes
              </CardTitle>
              <CardDescription>
                Control how messages are acknowledged. In manual mode, you must
                explicitly Ack, Nak, or Terminate each message.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Label>Mode:</Label>
                <div className="flex gap-2">
                  <Button
                    variant={ackMode === "auto-ack" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setAckMode("auto-ack")}
                  >
                    <CheckCircle2 className="mr-1.5 h-4 w-4" />
                    Auto-Ack
                  </Button>
                  <Button
                    variant={ackMode === "manual-ack" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setAckMode("manual-ack")}
                  >
                    <Clock className="mr-1.5 h-4 w-4" />
                    Manual-Ack
                  </Button>
                </div>
              </div>

              {ackMode === "manual-ack" && (
                <div className="flex items-center gap-3">
                  <Label htmlFor="nak-delay">Nak Redelivery Delay (seconds):</Label>
                  <Input
                    id="nak-delay"
                    type="number"
                    min={1}
                    max={30}
                    value={nakDelay}
                    onChange={(e) => setNakDelay(Number(e.target.value) || 1)}
                    className="w-20"
                  />
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                {!ackSubscription ? (
                  <Button onClick={startAckSubscriber} variant="outline">
                    <Plus className="mr-2 h-4 w-4" />
                    Start Subscriber
                  </Button>
                ) : (
                  <Button onClick={stopAckSubscriber} variant="outline">
                    <Minus className="mr-2 h-4 w-4" />
                    Stop Subscriber
                  </Button>
                )}
                <Button
                  onClick={emitAckEvent}
                  disabled={!ackSubscription}
                >
                  <Send className="mr-2 h-4 w-4" />
                  Emit Event
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setAckMessages([]);
                    setAckEmitCount(0);
                  }}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Reset
                </Button>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-4 gap-4">
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">Emitted</p>
                  <p className="text-xl font-bold">{ackEmitCount}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">Inflight</p>
                  <p className="text-xl font-bold text-yellow-600">{ackInflightCount}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">Processed</p>
                  <p className="text-xl font-bold text-green-600">{ackProcessedCount}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">Dead Letter</p>
                  <p className="text-xl font-bold text-red-600">{ackTermedCount}</p>
                </div>
              </div>

              {/* Mode explanation */}
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  {ackMode === "auto-ack"
                    ? "Auto-Ack: Messages are acknowledged immediately upon delivery. Simple but risky — if your consumer crashes mid-processing, the message is lost."
                    : "Manual-Ack: Messages stay inflight until you explicitly acknowledge them. If your consumer crashes, unacknowledged messages are redelivered to another consumer."}
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>

          {/* Action Reference */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-base">Action Reference</CardTitle>
              <CardDescription>
                In manual mode, each inflight message requires one of these actions.
                Unacknowledged messages will eventually time out and be redelivered.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="flex gap-3 p-3 rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/20">
                  <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Ack (Acknowledge)</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Confirms successful processing. The message is removed from the queue permanently.
                    </p>
                  </div>
                </div>
                <div className="flex gap-3 p-3 rounded-lg border border-orange-200 bg-orange-50 dark:bg-orange-950/20">
                  <AlertTriangle className="h-5 w-5 text-orange-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Nak (Negative Ack)</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Signals a transient failure. The message is redelivered after a configurable delay for retry.
                    </p>
                  </div>
                </div>
                <div className="flex gap-3 p-3 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20">
                  <XCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Term (Terminate)</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Signals a permanent failure. The message is moved to a dead letter queue and will not be retried.
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Message List */}
          {ackMessages.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Messages</CardTitle>
                <CardDescription>
                  {ackMode === "auto-ack"
                    ? "Messages are automatically acknowledged on receipt."
                    : "Use the action buttons to acknowledge, reject, or terminate each message."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {ackMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex items-center justify-between p-3 rounded-lg border ${
                        msg.status === "inflight"
                          ? "border-yellow-300 bg-yellow-50 dark:bg-yellow-950/20"
                          : msg.status === "acked"
                            ? "border-green-300 bg-green-50 dark:bg-green-950/20"
                            : msg.status === "nacked"
                              ? "border-orange-300 bg-orange-50 dark:bg-orange-950/20"
                              : "border-red-300 bg-red-50 dark:bg-red-950/20"
                      }`}
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        {msg.status === "inflight" && (
                          <Clock className="h-4 w-4 text-yellow-600 shrink-0" />
                        )}
                        {msg.status === "acked" && (
                          <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                        )}
                        {msg.status === "nacked" && (
                          <RotateCcw className="h-4 w-4 text-orange-600 shrink-0" />
                        )}
                        {msg.status === "termed" && (
                          <XCircle className="h-4 w-4 text-red-600 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{msg.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {msg.timestamp.toLocaleTimeString()}
                            {msg.redeliveryCount > 0 && (
                              <span className="ml-2">
                                Redeliveries: {msg.redeliveryCount}
                              </span>
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Badge
                          variant={
                            msg.status === "acked"
                              ? "default"
                              : msg.status === "termed"
                                ? "destructive"
                                : "secondary"
                          }
                          className="text-xs"
                        >
                          {msg.status}
                        </Badge>

                        {ackMode === "manual-ack" && msg.status === "inflight" && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs text-green-700 border-green-300 hover:bg-green-100"
                              onClick={() => handleAck(msg.id)}
                            >
                              <CheckCircle2 className="mr-1 h-3 w-3" />
                              Ack
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs text-orange-700 border-orange-300 hover:bg-orange-100"
                              onClick={() => handleNak(msg.id)}
                            >
                              <AlertTriangle className="mr-1 h-3 w-3" />
                              Nak
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs text-red-700 border-red-300 hover:bg-red-100"
                              onClick={() => handleTerm(msg.id)}
                            >
                              <Trash2 className="mr-1 h-3 w-3" />
                              Term
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center">
                <Inbox className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No Messages Yet</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Start a subscriber and emit events to see acknowledgment modes in
                  action.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ==================== Backpressure Tab ==================== */}
        <TabsContent value="backpressure">
          {/* Backpressure Controls */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5" />
                Backpressure Modes
              </CardTitle>
              <CardDescription>
                Simulate different backpressure strategies when message delivery
                exceeds consumer capacity.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Backpressure Mode</Label>
                  <Select
                    value={bpMode}
                    onValueChange={(val) => setBpMode(val as BackpressureMode)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select mode" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="drop">
                        Drop -- Discard excess messages
                      </SelectItem>
                      <SelectItem value="block">
                        Block -- Reject until capacity available
                      </SelectItem>
                      <SelectItem value="buffer">
                        Buffer -- Queue and deliver when ready
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>
                    Max Inflight: <span className="font-bold">{maxInflight}</span>
                  </Label>
                  <Slider
                    value={[maxInflight]}
                    onValueChange={(val) => setMaxInflight(val[0])}
                    min={1}
                    max={20}
                    step={1}
                    className="mt-2"
                  />
                  <p className="text-xs text-muted-foreground">
                    Maximum number of messages that can be in-flight simultaneously
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                {!bpSubscription ? (
                  <Button onClick={startBpSubscriber} variant="outline">
                    <Plus className="mr-2 h-4 w-4" />
                    Start Subscriber
                  </Button>
                ) : (
                  <Button onClick={stopBpSubscriber} variant="outline">
                    <Minus className="mr-2 h-4 w-4" />
                    Stop Subscriber
                  </Button>
                )}
                <Button
                  onClick={floodEvents}
                  disabled={isFlooding || !bpSubscription}
                >
                  <Zap className="mr-2 h-4 w-4" />
                  {isFlooding ? "Flooding..." : "Flood 20 Events"}
                </Button>
                <Button variant="outline" onClick={resetBpMessages}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Reset
                </Button>
              </div>

              {/* Mode Description */}
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  {bpMode === "drop" &&
                    "Drop mode: When max inflight is reached, new messages are silently discarded. Best for non-critical telemetry data."}
                  {bpMode === "block" &&
                    "Block mode: When max inflight is reached, new messages are rejected. The producer is signaled to slow down."}
                  {bpMode === "buffer" &&
                    "Buffer mode: When max inflight is reached, new messages are queued and delivered as capacity becomes available."}
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>

          {/* Backpressure Visualization */}
          <div className="grid gap-4 grid-cols-2 md:grid-cols-5 mb-6">
            <Card>
              <CardContent className="pt-6 text-center">
                <CheckCircle2 className="h-8 w-8 mx-auto text-green-600 mb-2" />
                <p className="text-2xl font-bold text-green-600">{bpDelivered}</p>
                <p className="text-xs text-muted-foreground">Inflight</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 text-center">
                <ShieldCheck className="h-8 w-8 mx-auto text-emerald-600 mb-2" />
                <p className="text-2xl font-bold text-emerald-600">{bpProcessed}</p>
                <p className="text-xs text-muted-foreground">Processed</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 text-center">
                <Inbox className="h-8 w-8 mx-auto text-blue-600 mb-2" />
                <p className="text-2xl font-bold text-blue-600">{bpQueued}</p>
                <p className="text-xs text-muted-foreground">Queued</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 text-center">
                <XCircle className="h-8 w-8 mx-auto text-red-600 mb-2" />
                <p className="text-2xl font-bold text-red-600">{bpDropped}</p>
                <p className="text-xs text-muted-foreground">Dropped</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 text-center">
                <AlertTriangle className="h-8 w-8 mx-auto text-orange-600 mb-2" />
                <p className="text-2xl font-bold text-orange-600">{bpBlocked}</p>
                <p className="text-xs text-muted-foreground">Blocked</p>
              </CardContent>
            </Card>
          </div>

          {/* Capacity Bar */}
          {bpSubscription && (
            <Card className="mb-6">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Inflight Capacity</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  <Progress
                    value={(bpDelivered / maxInflight) * 100}
                    className="h-3 flex-1"
                  />
                  <span className="text-sm font-medium whitespace-nowrap">
                    {bpDelivered} / {maxInflight}
                  </span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Message Log */}
          {bpMessages.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Message Log</CardTitle>
                <CardDescription>
                  Showing the outcome of each message under the selected backpressure
                  mode
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-1 max-h-[400px] overflow-y-auto">
                  {bpMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex items-center justify-between py-2 px-3 rounded text-sm transition-colors ${
                        msg.state === "delivered"
                          ? "bg-green-50 dark:bg-green-950/20"
                          : msg.state === "processed"
                            ? "bg-emerald-50/50 dark:bg-emerald-950/10"
                            : msg.state === "dropped"
                              ? "bg-red-50 dark:bg-red-950/20"
                              : msg.state === "queued"
                                ? "bg-blue-50 dark:bg-blue-950/20"
                                : "bg-orange-50 dark:bg-orange-950/20"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {msg.state === "delivered" && (
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                        )}
                        {msg.state === "processed" && (
                          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                        )}
                        {msg.state === "dropped" && (
                          <XCircle className="h-3.5 w-3.5 text-red-600" />
                        )}
                        {msg.state === "queued" && (
                          <Inbox className="h-3.5 w-3.5 text-blue-600" />
                        )}
                        {msg.state === "blocked" && (
                          <AlertTriangle className="h-3.5 w-3.5 text-orange-600" />
                        )}
                        <span className={`truncate ${msg.state === "processed" ? "text-muted-foreground" : ""}`}>{msg.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {msg.timestamp.toLocaleTimeString()}
                        </span>
                        <Badge
                          variant={
                            msg.state === "delivered"
                              ? "default"
                              : msg.state === "dropped"
                                ? "destructive"
                                : "secondary"
                          }
                          className="text-xs"
                        >
                          {msg.state}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center">
                <Zap className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No Messages Yet</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Start a subscriber and flood events to see backpressure handling in
                  action.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
