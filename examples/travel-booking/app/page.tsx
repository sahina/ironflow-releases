"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ironflow } from "@ironflow/browser";
import type { ConnectionState, Subscription } from "@ironflow/browser";
import type { TimeTravelTimelineEvent } from "@ironflow/core";
import { getTraveler, setTraveler } from "@/lib/ironflow";
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

interface QueuedBooking {
  bookingId: string;
  traveler: string;
  flightId: string;
  hotelId: string;
}

const QUEUE_KEY = "travel-booking:queued";

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
  const [offline, setOffline] = useState(false);
  const [queue, setQueue] = useState<QueuedBooking[]>([]);
  const [busy, setBusy] = useState(false);
  const [timeline, setTimeline] = useState<TimeTravelTimelineEvent[]>([]);
  const [scrub, setScrub] = useState(0);

  const subs = useRef<Subscription[]>([]);

  // ── Live read models ───────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setTravelerName(getTraveler());
    setQueue(readQueue());

    const wire = async <T,>(name: string, apply: (state: T) => void) => {
      const initial = await ironflow.getProjection<T>(name).catch(() => null);
      if (!cancelled && initial?.state) apply(initial.state);
      const sub = await ironflow.subscribeToProjection<T>(name, {
        onUpdate: (state) => {
          if (!cancelled && state) apply(state);
        },
      });
      if (cancelled) sub.unsubscribe();
      else subs.current.push(sub);
    };

    wire<Availability>(PROJECTIONS.Availability, setAvailability).catch(console.error);
    wire<BookingsState>(PROJECTIONS.Bookings, (s) => setBookings(s.bookings ?? [])).catch(console.error);

    const off = ironflow.onConnectionChange(setConnection);
    setConnection(ironflow.connectionState);

    return () => {
      cancelled = true;
      subs.current.forEach((s) => s.unsubscribe());
      subs.current = [];
      off();
    };
  }, []);

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
  // Deliberately app-side. The Ironflow browser SDK has no offline write queue;
  // this is ~20 lines of localStorage so the demo can show the pattern, and the
  // UI says so rather than passing it off as a platform feature.
  const flushQueue = useCallback(async () => {
    const pending = readQueue();
    if (pending.length === 0) return;
    writeQueue([]);
    setQueue([]);
    for (const item of pending) {
      await ironflow.emit(BOOKING_REQUESTED, item).catch(console.error);
      setCurrentBookingId(item.bookingId);
    }
  }, []);

  useEffect(() => {
    const onOnline = () => {
      setOffline(false);
      flushQueue();
    };
    const onOffline = () => setOffline(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    if (!navigator.onLine) setOffline(true);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [flushQueue]);

  // ── Actions ────────────────────────────────────────────────────

  const book = async (as?: string) => {
    const request: QueuedBooking = {
      bookingId: crypto.randomUUID(),
      traveler: as ?? traveler,
      flightId,
      hotelId,
    };

    if (offline) {
      const next = [...readQueue(), request];
      writeQueue(next);
      setQueue(next);
      return;
    }

    setBusy(true);
    try {
      await ironflow.emit(BOOKING_REQUESTED, request);
      // Only follow the booking made as *you* — a simulated traveller shouldn't
      // hijack the timeline you're watching.
      if (!as) {
        setCurrentBookingId(request.bookingId);
        setTimeline([]);
        setScrub(0);
      }
    } catch (err) {
      console.error("[booking] emit failed:", err);
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
    if (!runId) return;
    const events = await ironflow.getRunTimeline(runId).catch(() => []);
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

      <div className="grid grid-cols-[300px_1fr_200px] gap-4 flex-1">
        <TripPicker
          availability={availability}
          flightId={flightId}
          hotelId={hotelId}
          onFlight={setFlightId}
          onHotel={setHotelId}
          onBook={() => book()}
          busy={busy}
          offline={offline}
          queued={queue.length}
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
          onToggleOffline={() => {
            const next = !offline;
            setOffline(next);
            if (!next) flushQueue();
          }}
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

function readQueue(): QueuedBooking[] {
  try {
    return JSON.parse(window.localStorage.getItem(QUEUE_KEY) ?? "[]") as QueuedBooking[];
  } catch {
    return [];
  }
}

function writeQueue(items: QueuedBooking[]): void {
  window.localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
}

function otherTraveler(me: string): string {
  return me === "Robin" ? "Sam" : "Robin";
}
