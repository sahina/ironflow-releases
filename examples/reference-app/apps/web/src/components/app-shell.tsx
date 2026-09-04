"use client";

// The one place the browser SDK is configured, and the one place the demo
// session lives. Everything below it takes the client and the session as props.

import { useEffect, useMemo, useState } from "react";

import { IronflowProvider } from "@/components/ironflow-provider";
import { browserIronflow } from "@/lib/browser-client";
import { currentDemoSession, startNewDemoSession } from "@/lib/session";

export function AppShell({
  serverUrl,
  apiKey,
  children,
  showSession = true,
}: {
  serverUrl: string;
  apiKey: string;
  children: (session: string) => React.ReactNode;
  /** `/system` describes the whole system, which no demo session filters. */
  showSession?: boolean;
}) {
  const client = useMemo(() => browserIronflow({ serverUrl, apiKey }), [serverUrl, apiKey]);
  // localStorage exists only in the browser, so the session is read after the
  // first paint rather than during the server render.
  const [session, setSession] = useState<string | undefined>(undefined);
  useEffect(() => setSession(currentDemoSession()), []);

  if (!session) return <p>Connecting…</p>;

  return (
    <IronflowProvider client={client}>
      {showSession && (
      <div className="session">
        <span>
          Demo session <code>{session.slice(0, 8)}</code>
        </span>
        <button type="button" onClick={() => setSession(startNewDemoSession())}>
          New demo session
        </button>
        <small>Starting a new session hides earlier orders. Nothing is deleted.</small>
      </div>
      )}
      {children(session)}
    </IronflowProvider>
  );
}
