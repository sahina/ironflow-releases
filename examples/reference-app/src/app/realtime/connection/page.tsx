"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { ironflow, type ConnectionState } from "@ironflow/browser";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Cable, Loader2, WifiOff, Zap } from "lucide-react";

interface ConnectionEvent {
  id: string;
  type: "connected" | "disconnected" | "reconnecting" | "error";
  timestamp: Date;
  message?: string;
}

function formatUptime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

export default function ConnectionStatePage() {
  const [state, setState] = useState<ConnectionState>("disconnected");
  const [events, setEvents] = useState<ConnectionEvent[]>([]);
  const [uptime, setUptime] = useState(0);
  const [reconnectCount, setReconnectCount] = useState(0);
  const lastStateRef = useRef<ConnectionState>("disconnected");
  const connectedAtRef = useRef<Date | null>(null);

  // Poll connection state every 500ms and track state changes
  useEffect(() => {
    const pollState = () => {
      const currentState = ironflow.connectionState;

      if (currentState !== lastStateRef.current) {
        const prevState = lastStateRef.current;
        lastStateRef.current = currentState;
        setState(currentState);

        // Track state change as event
        const eventType =
          currentState === "connected"
            ? "connected"
            : currentState === "disconnected"
              ? "disconnected"
              : currentState === "reconnecting"
                ? "reconnecting"
                : "error";

        const newEvent: ConnectionEvent = {
          id: crypto.randomUUID(),
          type: eventType,
          timestamp: new Date(),
          message: `State changed from ${prevState} to ${currentState}`,
        };

        setEvents((prev) => [newEvent, ...prev].slice(0, 50));

        // Track reconnect count
        if (currentState === "reconnecting") {
          setReconnectCount((prev) => prev + 1);
        }

        // Track connection start time
        if (currentState === "connected") {
          connectedAtRef.current = new Date();
        } else if (currentState === "disconnected") {
          connectedAtRef.current = null;
        }
      }
    };

    const interval = setInterval(pollState, 500);
    pollState(); // Initial poll

    return () => clearInterval(interval);
  }, []);

  // Track uptime when connected
  useEffect(() => {
    if (state !== "connected") {
      // Use a microtask to avoid synchronous setState in effect body
      queueMicrotask(() => setUptime(0));
      return;
    }

    const interval = setInterval(() => {
      if (connectedAtRef.current) {
        const seconds = Math.floor(
          (Date.now() - connectedAtRef.current.getTime()) / 1000
        );
        setUptime(seconds);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [state]);

  const handleConnect = useCallback(async () => {
    try {
      await ironflow.connect();
    } catch (error) {
      const newEvent: ConnectionEvent = {
        id: crypto.randomUUID(),
        type: "error",
        timestamp: new Date(),
        message: error instanceof Error ? error.message : "Connection failed",
      };
      setEvents((prev) => [newEvent, ...prev].slice(0, 50));
    }
  }, []);

  const handleDisconnect = useCallback(() => {
    ironflow.disconnect();
  }, []);

  const simulateDisconnect = useCallback(async () => {
    ironflow.disconnect();
    setTimeout(async () => {
      try {
        await ironflow.connect();
      } catch {
        // Connection error will be tracked by state polling
      }
    }, 2000);
  }, []);

  const getStatusIcon = () => {
    switch (state) {
      case "connected":
        return <Cable className="h-5 w-5 text-green-500" />;
      case "connecting":
        return <Loader2 className="h-5 w-5 text-yellow-500 animate-spin" />;
      case "reconnecting":
        return <Loader2 className="h-5 w-5 text-yellow-500 animate-spin" />;
      case "disconnected":
        return <WifiOff className="h-5 w-5 text-red-500" />;
      default:
        return <WifiOff className="h-5 w-5 text-gray-500" />;
    }
  };

  const getStatusBadge = () => {
    switch (state) {
      case "connected":
        return (
          <Badge variant="default" className="bg-green-500">
            Connected
          </Badge>
        );
      case "connecting":
        return (
          <Badge variant="default" className="bg-yellow-500">
            Connecting
          </Badge>
        );
      case "reconnecting":
        return (
          <Badge variant="default" className="bg-yellow-500">
            Reconnecting
          </Badge>
        );
      case "disconnected":
        return <Badge variant="destructive">Disconnected</Badge>;
      default:
        return <Badge variant="secondary">Unknown</Badge>;
    }
  };

  const getEventBadge = (type: ConnectionEvent["type"]) => {
    switch (type) {
      case "connected":
        return (
          <Badge variant="default" className="bg-green-500">
            Connected
          </Badge>
        );
      case "disconnected":
        return <Badge variant="destructive">Disconnected</Badge>;
      case "reconnecting":
        return (
          <Badge variant="default" className="bg-yellow-500">
            Reconnecting
          </Badge>
        );
      case "error":
        return <Badge variant="destructive">Error</Badge>;
    }
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <section className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">
          Connection State
        </h1>
        <p className="text-muted-foreground">
          Monitor and control the WebSocket connection to the Ironflow server.
        </p>
      </section>

      {/* Stats Cards */}
      <section className="grid gap-4 md:grid-cols-3 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Status</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              {getStatusIcon()}
              {getStatusBadge()}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Uptime</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatUptime(uptime)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Reconnections</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{reconnectCount}</div>
          </CardContent>
        </Card>
      </section>

      {/* Controls */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Controls</CardTitle>
          <CardDescription>Manage the connection state</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 flex-wrap">
            <Button
              onClick={handleConnect}
              disabled={state === "connected" || state === "connecting"}
            >
              <Cable className="mr-2 h-4 w-4" />
              Connect
            </Button>
            <Button
              onClick={handleDisconnect}
              variant="outline"
              disabled={state === "disconnected"}
            >
              <WifiOff className="mr-2 h-4 w-4" />
              Disconnect
            </Button>
            <Button
              onClick={simulateDisconnect}
              variant="secondary"
              disabled={state === "disconnected"}
            >
              <Zap className="mr-2 h-4 w-4" />
              Simulate Reconnect
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Events */}
      <Card>
        <CardHeader>
          <CardTitle>Connection Events</CardTitle>
          <CardDescription>
            History of connection state changes
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-80 overflow-y-auto space-y-2">
            {events.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No connection events yet
              </p>
            ) : (
              events.map((event) => (
                <div
                  key={event.id}
                  className="flex items-center justify-between py-2 border-b last:border-b-0"
                >
                  <div className="flex items-center gap-3">
                    {getEventBadge(event.type)}
                    <span className="text-sm text-muted-foreground">
                      {event.message}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {event.timestamp.toLocaleTimeString()}
                  </span>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
