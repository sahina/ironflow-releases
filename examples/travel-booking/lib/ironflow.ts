"use client";

import { createClient, type OfflineClient } from "@ironflow/browser";

let appPromise: Promise<OfflineClient> | null = null;

/**
 * The offline-capable client (ADR 0053).
 *
 * Lazy and browser-only on purpose: `createClient` opens IndexedDB, and it
 * needs the traveller's name for `identity`, which lives in sessionStorage.
 * Call it from an effect, never at module scope.
 *
 * `identity` and `dbName` are both derived from the traveller, and they have to
 * agree. The default is one outbox per origin, so two tabs under two names
 * would share a queue and the drain would quarantine the other tab's writes as
 * `identity-mismatch`.
 *
 * Renaming does NOT rebuild the client: `appPromise` is already resolved, so
 * the tab keeps writing to the original outbox under the original identity for
 * the rest of the session. The cost lands on the next reload, which opens
 * `travel-booking:{new name}` and leaves anything still pending in the old
 * outbox stranded until you rename back. Acceptable in a demo; a real app keys
 * identity on a stable user id, not a display name.
 *
 * Not memoised per traveller: one client per tab is the point. Nothing calls
 * `close()` either — it also disconnects the underlying client, so a React
 * strict-mode double-mount would hand the second mount a dead one.
 *
 * A rejection clears the memo. `??=` on its own would cache the REJECTED
 * promise, so every later call — including a user pressing "Try again" — would
 * be handed the same failure and could never recover.
 *
 * Rejecting at all is rare: `createClient` already falls back to direct writes
 * when IndexedDB is absent, and again when the outbox fails to open. What is
 * left is a bad `serverUrl` reaching `configure()`.
 *
 * Hanging is the likelier failure, and the SDK cannot time it out for you:
 * `indexedDB.open` blocks for as long as another tab holds the database open
 * across a version change, with no deadline of its own. Measured cost when
 * nothing is blocking: ~0.7ms. So anything past a couple of seconds is a stuck
 * open, not a slow one, and the app should say so rather than sit on
 * "Starting…" forever.
 */
const START_TIMEOUT_MS = 5_000;

function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${what} did not finish in ${ms}ms — another tab may be holding the outbox open.`)),
      ms
    );
    work.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

export function getApp(): Promise<OfflineClient> {
  appPromise ??= (async () => {
    const traveler = getTraveler();
    const app = await withTimeout(
      createClient({
        serverUrl: process.env.NEXT_PUBLIC_IRONFLOW_SERVER_URL,
        offlineQueue: {
          identity: traveler,
          dbName: `travel-booking:${traveler}`,
          onWriteLost: (write, reason, message) => {
            console.error("[ironflow] write lost:", write.kind, reason, message);
          },
        },
      }),
      START_TIMEOUT_MS,
      "Opening the offline outbox"
    );
    // Fired, never awaited. Awaiting it would stall the whole app behind the
    // connect — and worst of all offline, where it burns its full timeout
    // before the UI can render. That is the one case this example exists to
    // demonstrate, so the client is handed over immediately and writes go to
    // the outbox until the connection arrives.
    app.client.connect().catch((err) => {
      console.error("[ironflow] Failed to connect:", err);
    });
    return app;
  })().catch((err) => {
    appPromise = null;
    throw err;
  });
  return appPromise;
}

/**
 * Who this tab is.
 *
 * sessionStorage, not localStorage: localStorage is shared by every tab on the
 * origin, so two tabs would be the same traveller and the race demo would look
 * broken. Caveat that survives no amount of code — *duplicating* a tab copies
 * sessionStorage too. Open a new tab to localhost:3000 instead, or rename.
 */
export function getTraveler(): string {
  if (typeof window === "undefined") return "";
  const existing = window.sessionStorage.getItem("traveler");
  if (existing) return existing;
  const name = NAMES[Math.floor(Math.random() * NAMES.length)];
  window.sessionStorage.setItem("traveler", name);
  return name;
}

export function setTraveler(name: string): void {
  window.sessionStorage.setItem("traveler", name);
}

const NAMES = ["Alice", "Bob", "Cleo", "Dev", "Emi", "Fen", "Gus", "Hana"];
