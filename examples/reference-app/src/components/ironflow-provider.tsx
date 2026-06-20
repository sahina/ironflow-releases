"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { ironflow } from "@ironflow/browser";

interface IronflowContextValue {
  isConnected: boolean;
  isConnecting: boolean;
  error: Error | null;
}

const IronflowContext = createContext<IronflowContextValue>({
  isConnected: false,
  isConnecting: true,
  error: null,
});

/**
 * Hook to access Ironflow connection status
 */
export function useIronflow() {
  return useContext(IronflowContext);
}

interface IronflowProviderProps {
  children: ReactNode;
  serverUrl?: string;
}

export function IronflowProvider({
  children,
  serverUrl = "http://localhost:9123",
}: IronflowProviderProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // Configure the ironflow client
    const apiKey = process.env.NEXT_PUBLIC_IRONFLOW_API_KEY;
    ironflow.configure({
      serverUrl,
      ...(apiKey && { auth: { apiKey } }),
      reconnect: {
        enabled: true,
        maxAttempts: 10,
        backoff: {
          initial: 1000,
          max: 30000,
          multiplier: 2,
        },
      },
    });

    // Connect to the server — initial state is already isConnecting=true via useState
    ironflow
      .connect()
      .then(async () => {
        setIsConnected(true);
        setIsConnecting(false);

        // Register functions with the Ironflow server so trigger() can find them
        try {
          await fetch("/api/ironflow");
        } catch (err) {
          console.warn("Function registration failed:", err);
        }
      })
      .catch((err) => {
        console.error("Failed to connect to Ironflow server:", err);
        setError(err instanceof Error ? err : new Error(String(err)));
        setIsConnected(false);
        setIsConnecting(false);
      });

    // Cleanup on unmount
    return () => {
      ironflow.disconnect();
      setIsConnected(false);
    };
  }, [serverUrl]);

  return (
    <IronflowContext.Provider value={{ isConnected, isConnecting, error }}>
      {children}
    </IronflowContext.Provider>
  );
}
