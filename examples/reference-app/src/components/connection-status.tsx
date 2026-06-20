"use client";

import { useState, useEffect } from "react";
import { ironflow, type ConnectionState } from "@ironflow/browser";
import { Badge } from "@/components/ui/badge";
import { Cable, Loader2, WifiOff } from "lucide-react";

export function ConnectionStatus() {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>(() => ironflow.connectionState ?? "disconnected");

  useEffect(() => {
    // Poll connection state every 1000ms
    // The initial state is read synchronously via the useState initializer,
    // so we only need the interval here for subsequent updates.
    const interval = setInterval(() => {
      setConnectionState(ironflow.connectionState);
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  }, []);

  if (connectionState === "connected") {
    return (
      <Badge className="bg-green-500/10 text-green-500 hover:bg-green-500/20">
        <Cable className="h-3 w-3" />
        Connected
      </Badge>
    );
  }

  if (connectionState === "connecting") {
    return (
      <Badge className="bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20">
        <Loader2 className="h-3 w-3 animate-spin" />
        Connecting
      </Badge>
    );
  }

  return (
    <Badge className="bg-red-500/10 text-red-500 hover:bg-red-500/20">
      <WifiOff className="h-3 w-3" />
      Disconnected
    </Badge>
  );
}
