"use client";

// The two live views, as client components.
//
// They exist because a server page cannot hand a render prop to a client
// component: only plain values cross that boundary. The pages read the engine
// URL and the demo credential on the server and pass strings; the composing
// happens here.

import { AppShell } from "@/components/app-shell";
import { Operations } from "@/components/operations";
import { Shop } from "@/components/shop";
import { SystemLive } from "@/components/system-live";

type ViewProps = { serverUrl: string; apiKey: string };

export function ShopView({ serverUrl, apiKey }: ViewProps) {
  return (
    <AppShell serverUrl={serverUrl} apiKey={apiKey}>
      {(session) => <Shop session={session} dashboardUrl={serverUrl} />}
    </AppShell>
  );
}

export function OperationsView({ serverUrl, apiKey }: ViewProps) {
  return (
    <AppShell serverUrl={serverUrl} apiKey={apiKey}>
      {(session) => <Operations session={session} dashboardUrl={serverUrl} />}
    </AppShell>
  );
}

export function SystemView({ serverUrl, apiKey }: ViewProps) {
  return (
    <AppShell serverUrl={serverUrl} apiKey={apiKey} showSession={false}>
      {(session) => <SystemLive session={session} dashboardUrl={serverUrl} />}
    </AppShell>
  );
}
