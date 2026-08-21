"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnectionState, OfflineClient, Subscription } from "@ironflow/browser";
import type { TimeTravelTimelineEvent } from "@ironflow/core";
import { getApp, getTraveler, setTraveler } from "@/lib/ironflow";
import {
  BOOKING_REQUESTED,
  emptyAvailability,
  FLIGHTS,
  HOTELS,
  PROJECTIONS,
  type Availability,
  type Booking,
  type BookingsState,
} from "@/domain";
import { ChaosPanel, JourneyTimeline, TimeTravel, TravelerPill, TripPicker } from "@/components/panels";

type PaymentMode = "normal" | "fail" | "slow";

export default function Home() {
  const [availability, setAvailability] = useState<Availability>(emptyAvailability);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [traveler, setTravelerName] = useState("");
  const [flightId, setFlightId] = useState(FLIGHTS[0].id);
  const [hotelId, setHotelId] = useState(HOTELS[0].id);
  const [currentBookingId, setCurrentBookingId] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("disconnected");
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("normal");
  const [workerDown, setWorkerDown] = useState(false);
  const [app, setApp] = useState<OfflineClient | null>(null);
  const [appError, setAppError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [queued, setQueued] = useState(0);
  const [busy, setBusy] = useState(false);
  const [timeline, setTimeline] = useState<TimeTravelTimelineEvent[]>([]);
  const [scrub, setScrub] = useState(0);

  const subs = useRef<Subscription[]>([]);

  // ── The client ─────────────────────────────────────────────────
  // Async because the outbox has to be open before the first write can be
  // answered honestly. Everything below waits for it.
  //
  // A failure here has to be visible. Every write path is gated on `app`, so
  // swallowing this into console.error would leave the whole UI inert with no
  // reason given and no way back.
  const startClient = useCallback(() => {
    setAppError(null);
    getApp()
      .then(setApp)
      .catch((err) => setAppError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    setTravelerName(getTraveler());
    startClient();
  }, [startClient]);

  // ── Live read models ───────────────────────────────────────────
  useEffect(() => {
    if (!app) return;
    let cancelled = false;

    const wire = async <T,>(name: string, apply: (state: T) => void) => {
      const initial = await app.client.getProjection<T>(name).catch(() => null);
      if (!cancelled && initial?.state) apply(initial.state);
      const sub = await app.client.subscribeToProjection<T>(name, {
        onUpdate: (state) => {
          if (!cancelled && state) apply(state);
        },
      });
      if (cancelled) sub.unsubscribe();
      else subs.current.push(sub);
    };

    wire<Availability>(PROJECTIONS.Availability, setAvailability).catch(console.error);
    wire<BookingsState>(PROJECTIONS.Bookings, (s) => setBookings(s.bookings ?? [])).catch(console.error);

    const off = app.client.onConnectionChange(setConnection);
    setConnection(app.client.connectionState);

    return () => {
      cancelled = true;
      subs.current.forEach((s) => s.unsubscribe());
      subs.current = [];
      off();
    };
  }, [app]);

  // ── Is the worker alive, and what has been broken? ─────────────
  // Polled rather than pushed: a crashed worker can't tell you it died.
  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch("/api/chaos");
        if (!res.ok) throw new Error("down");
        const state = (await res.json()) as { paymentMode: PaymentMode };
        setWorkerDown(false);
        setPaymentMode(state.paymentMode);
      } catch {
        setWorkerDown(true);
      }
    };
    check();
    const timer = setInterval(check, 1500);
    return () => clearInterval(timer);
  }, []);

  // ── Offline queue ──────────────────────────────────────────────
  // The SDK owns this now (ADR 0053). `createClient({ offlineQueue })` persists
  // every emit to an IndexedDB outbox before it sends and drains it in FIFO on
  // reconnect, so there is no app-side queue left to write. All that remains is
  // showing the count.
  useEffect(() => {
    if (!app) return;
    return app.queue.subscribe((stats) => setQueued(stats.pending));
  }, [app]);

  // Real connectivity, not a simulated flag: only a genuine network failure
  // exercises the drain loop. Use DevTools → Network → Offline to try it.
  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  // ── Actions ────────────────────────────────────────────────────

  const book = async (as?: string) => {
    if (!app) return;

    const request = {
      // Client-generated, so it is the same id whether this booking goes out
      // now or drains from the outbox in an hour.
      bookingId: crypto.randomUUID(),
      traveler: as ?? traveler,
      flightId,
      hotelId,
    };

    setBusy(true);
    try {
      // One path, online or off. Offline this returns `{ queued: true }` the
      // moment it is persisted, so there is no branch to write here.
      await app.emit(BOOKING_REQUESTED, request);
      // Only follow the booking made as *you* — a simulated traveller shouldn't
      // hijack the timeline you're watching.
      if (!as) {
        setCurrentBookingId(request.bookingId);
        setTimeline([]);
        setScrub(0);
      }
    } catch (err) {
      // No longer a network error — the outbox absorbs those. What is left is
      // a full queue (500 items / 5 MB) or a body that would not serialise.
      console.error("[booking] emit rejected:", err);
    } finally {
      setBusy(false);
    }
  };

  const chaos = async (action: string, mode?: PaymentMode) => {
    await fetch("/api/chaos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, mode }),
    }).catch(() => undefined);
  };

  const loadTimeline = async () => {
    const runId = current?.runId;
    if (!app || !runId) return;
    const events = await app.client.getRunTimeline(runId).catch(() => []);
    setTimeline(events);
    setScrub(Math.max(0, events.length - 1));
  };

  const current = bookings.find((b) => b.id === currentBookingId) ?? null;

  return (
    <main className="min-h-screen p-6 flex flex-col gap-4 max-w-[1400px] mx-auto">
      <header className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold">Ironflow Travel</h1>
          <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
            One trip, three steps, every way it can go wrong.
          </p>
        </div>
        <TravelerPill
          name={traveler}
          onRename={(n) => {
            setTravelerName(n);
            setTraveler(n);
          }}
        />
      </header>

      {appError && (
        <div
          role="alert"
          className="panel p-3 flex items-baseline gap-3 text-sm"
          style={{ borderColor: "var(--color-error)", color: "var(--color-error)" }}
        >
          <span>
            Could not start the offline client — booking is disabled. {appError}
          </span>
          <button onClick={startClient} className="btn mono ml-auto">
            Try again
          </button>
        </div>
      )}

      <div className="grid grid-cols-[300px_1fr_200px] gap-4 flex-1">
        <TripPicker
          availability={availability}
          flightId={flightId}
          hotelId={hotelId}
          onFlight={setFlightId}
          onHotel={setHotelId}
          onBook={() => book()}
          busy={busy}
          ready={Boolean(app)}
          offline={offline}
          queued={queued}
        />

        <JourneyTimeline booking={current} />

        <ChaosPanel
          paymentMode={paymentMode}
          workerDown={workerDown}
          offline={offline}
          connection={connection}
          onCrash={() => chaos("crash")}
          onPaymentMode={(mode) => {
            setPaymentMode(mode);
            chaos("payment-mode", mode);
          }}
          onSimulate={() => book(otherTraveler(traveler))}
          ready={Boolean(app)}
          queued={queued}
          onFlush={() => app?.queue.flush().catch(console.error)}
          onReset={() => chaos("reset")}
        />
      </div>

      <TimeTravel
        timeline={timeline}
        position={scrub}
        onScrub={setScrub}
        onLoad={loadTimeline}
        hasRun={Boolean(current?.runId)}
      />
    </main>
  );
}

// ─── helpers ────────────────────────────────────────────────────

function otherTraveler(me: string): string {
  return me === "Robin" ? "Sam" : "Robin";
}
