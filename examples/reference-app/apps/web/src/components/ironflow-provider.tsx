"use client";

import { createContext, useContext } from "react";

import type { IronflowClient } from "@/lib/client";

const IronflowContext = createContext<IronflowClient | undefined>(undefined);

export function IronflowProvider({
  client,
  children,
}: {
  client: IronflowClient;
  children: React.ReactNode;
}) {
  return <IronflowContext.Provider value={client}>{children}</IronflowContext.Provider>;
}

/** The engine, as a component sees it. Throws rather than reaching for a global. */
export function useIronflow(): IronflowClient {
  const client = useContext(IronflowContext);
  if (!client) throw new Error("useIronflow needs an <IronflowProvider> above it");
  return client;
}
