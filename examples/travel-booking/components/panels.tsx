"use client";

import type { ConnectionState } from "@ironflow/browser";
import type { TimeTravelTimelineEvent } from "@ironflow/core";
import {
  FLIGHTS,
  HOTELS,
  roomsLeft,
  seatsLeft,
  type Availability,
  type Booking,
} from "@/domain";

// ─── ZONE 1: pick a trip ────────────────────────────────────────

export function TripPicker(props: {
  availability: Availability;
  flightId: string;
  hotelId: string;
  onFlight: (id: string) => void;
  onHotel: (id: string) => void;
  onBook: () => void;
  busy: boolean;
  /** False until the offline client has opened its outbox. */
  ready: boolean;
  offline: boolean;
  queued: number;
}) {
  const { availability, flightId, hotelId } = props;

  return (
    <section className="panel p-4 flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 className="panel-title">Flights</h2>
        {FLIGHTS.map((flight) => {
          const left = seatsLeft(availability, flight.id);
          return (
            <button
              key={flight.id}
              onClick={() => props.onFlight(flight.id)}
              disabled={left <= 0}
              className={`card ${flightId === flight.id ? "card-selected" : ""}`}
            >
              <div className="flex justify-between items-baseline">
                <span className="mono text-sm">{flight.code}</span>
                <span className="text-sm">${flight.price}</span>
              </div>
              <div className="flex justify-between items-baseline mt-1">
                <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                  {flight.from} → {flight.to} · {flight.depart}
                </span>
                <SeatCount left={left} unit="seat" />
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="panel-title">Hotels</h2>
        {HOTELS.map((hotel) => {
          const left = roomsLeft(availability, hotel.id);
          return (
            <button
              key={hotel.id}
              onClick={() => props.onHotel(hotel.id)}
              disabled={left <= 0}
              className={`card ${hotelId === hotel.id ? "card-selected" : ""}`}
            >
              <div className="flex justify-between items-baseline">
                <span className="text-sm">{hotel.name}</span>
                <span className="text-sm">${hotel.price}</span>
              </div>
              <div className="flex justify-between items-baseline mt-1">
                <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                  {hotel.city} · {hotel.nights} nights
                </span>
                <SeatCount left={left} unit="room" />
              </div>
            </button>
          );
        })}
      </div>

      <button
        onClick={props.onBook}
        disabled={!props.ready || props.busy || !flightId || !hotelId}
        className="btn btn-primary mono"
      >
        {!props.ready
          ? "Starting…"
          : props.busy
            ? "Booking…"
            : props.offline
              ? "Queue booking (offline)"
              : "Book trip"}
      </button>

      {props.queued > 0 && (
        <p className="text-xs" style={{ color: "var(--color-warning)" }}>
          {props.queued} booking{props.queued === 1 ? "" : "s"} waiting for the network.
          <br />
          <span style={{ color: "var(--color-text-muted)" }}>
            Saved in the SDK&rsquo;s IndexedDB outbox, sent when the network returns.
          </span>
        </p>
      )}
    </section>
  );
}

function SeatCount({ left, unit }: { left: number; unit: string }) {
  if (left <= 0) {
    return (
      <span className="mono text-xs" style={{ color: "var(--color-text-muted)" }}>
        sold out
      </span>
    );
  }
  // The last one is the demo's contested resource — make it impossible to miss.
  const scarce = left === 1;
  return (
    <span
      className="mono text-xs"
      style={{ color: scarce ? "var(--color-warning)" : "var(--color-text-secondary)" }}
    >
      {scarce ? "⚠ " : ""}
      {left} {unit}
      {left === 1 ? "" : "s"} left
    </span>
  );
}

// ─── ZONE 2: journey timeline ───────────────────────────────────

const STEPS = ["Reserve flight", "Reserve hotel", "Charge card"];

export function JourneyTimeline({ booking }: { booking: Booking | null }) {
  if (!booking) {
    return (
      <section className="panel p-4 flex flex-col">
        <h2 className="panel-title mb-3">Journey</h2>
        <p className="text-sm m-auto" style={{ color: "var(--color-text-muted)" }}>
          Pick a flight and a hotel, then book.
        </p>
      </section>
    );
  }

  const done = new Map(booking.steps.map((s) => [s.label, s]));

  return (
    <section className="panel p-4 flex flex-col gap-3">
      <div className="flex justify-between items-baseline">
        <h2 className="panel-title">Journey</h2>
        <span className="mono text-xs" style={{ color: "var(--color-text-muted)" }}>
          {booking.traveler}
        </span>
      </div>

      <ol className="flex flex-col gap-2">
        {STEPS.map((label, i) => {
          const step = done.get(label);
          const failedHere = booking.status === "failed" && !step && !anyLaterDone(done, i);
          return (
            <li key={label} className="flex items-center gap-3 text-sm">
              <StepMark step={step} failed={failedHere} running={booking.status === "running" && !step} />
              <span
                style={{
                  color: step?.undone ? "var(--color-text-muted)" : "var(--color-text)",
                  textDecoration: step?.undone ? "line-through" : "none",
                }}
              >
                {i + 1}. {label}
              </span>
              {step?.undone && (
                <span className="mono text-xs" style={{ color: "var(--color-pillar-rewind)" }}>
                  ↩ rolled back
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {booking.status === "failed" && booking.failureReason && (
        <p
          className="text-sm border-l-2 pl-3 mt-1"
          style={{ borderColor: "var(--color-error)", color: "var(--color-text-secondary)" }}
        >
          {booking.failureReason}
        </p>
      )}

      {booking.status === "confirmed" && (
        <p className="text-sm mono" style={{ color: "var(--color-success)" }}>
          Trip confirmed.
        </p>
      )}
    </section>
  );
}

function anyLaterDone(done: Map<string, unknown>, index: number): boolean {
  return STEPS.slice(index + 1).some((label) => done.has(label));
}

function StepMark({
  step,
  failed,
  running,
}: {
  step: { undone: boolean } | undefined;
  failed: boolean;
  running: boolean;
}) {
  const size = "inline-block h-2 w-2";
  if (step?.undone) return <span className={size} style={{ background: "var(--color-pillar-rewind)" }} />;
  if (step) return <span className={size} style={{ background: "var(--color-success)" }} />;
  if (failed) return <span className={size} style={{ background: "var(--color-error)" }} />;
  if (running)
    return <span className={`${size} pulsing`} style={{ background: "var(--color-brand-text)" }} />;
  return <span className={size} style={{ background: "var(--color-border-strong)" }} />;
}

// ─── ZONE 3: chaos panel ────────────────────────────────────────

export function ChaosPanel(props: {
  paymentMode: string;
  workerDown: boolean;
  offline: boolean;
  connection: ConnectionState;
  onCrash: () => void;
  onPaymentMode: (mode: "normal" | "fail" | "slow") => void;
  onSimulate: () => void;
  /** False until the offline client has opened its outbox. */
  ready: boolean;
  queued: number;
  onFlush: () => void;
  onReset: () => void;
}) {
  return (
    <section className="panel p-4 flex flex-col gap-2">
      <h2 className="panel-title mb-1">Chaos</h2>

      <button onClick={props.onCrash} className="btn mono">
        Crash worker
      </button>

      <button
        onClick={() => props.onPaymentMode(props.paymentMode === "fail" ? "normal" : "fail")}
        className={`btn mono ${props.paymentMode === "fail" ? "btn-active" : ""}`}
      >
        {props.paymentMode === "fail" ? "✓ " : ""}Fail payment
      </button>

      <button
        onClick={() => props.onPaymentMode(props.paymentMode === "slow" ? "normal" : "slow")}
        className={`btn mono ${props.paymentMode === "slow" ? "btn-active" : ""}`}
      >
        {props.paymentMode === "slow" ? "✓ " : ""}Slow payment
      </button>

      {/* No "go offline" button: a UI flag cannot exercise a real drain loop.
          Use DevTools → Network → Offline, book a trip, then come back. */}
      <button
        onClick={props.onFlush}
        disabled={props.queued === 0}
        className="btn mono"
        title={props.queued === 0 ? "Nothing queued" : "Drain the outbox now, resetting the retry backoff"}
      >
        Retry now{props.queued > 0 ? ` (${props.queued})` : ""}
      </button>
      <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
        Offline: DevTools &rarr; Network &rarr; Offline, then book.
      </p>

      <button onClick={props.onSimulate} disabled={!props.ready} className="btn mono">
        Simulate traveller
      </button>

      <button onClick={props.onReset} className="btn mono">
        Reset inventory
      </button>

      <div className="mt-auto pt-4 flex flex-col gap-1.5">
        <Status
          ok={!props.workerDown}
          label={props.workerDown ? "worker down" : "worker up"}
          pulse={props.workerDown}
        />
        <Status
          ok={props.connection === "connected"}
          label={props.connection}
          pulse={props.connection === "connecting" || props.connection === "reconnecting"}
        />
        <Status
          ok={!props.offline && props.queued === 0}
          label={
            props.offline
              ? props.queued > 0
                ? `offline, ${props.queued} queued`
                : "offline"
              : props.queued > 0
                ? `${props.queued} queued`
                : "outbox empty"
          }
          pulse={props.queued > 0}
        />
      </div>
    </section>
  );
}

function Status({ ok, label, pulse }: { ok: boolean; label: string; pulse: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${pulse ? "pulsing" : ""}`}
        style={{ background: ok ? "var(--color-success)" : "var(--color-error)" }}
      />
      <span className="mono text-xs" style={{ color: "var(--color-text-muted)" }}>
        {label}
      </span>
    </div>
  );
}

// ─── ZONE 4: time travel ────────────────────────────────────────

export function TimeTravel(props: {
  timeline: TimeTravelTimelineEvent[];
  position: number;
  onScrub: (position: number) => void;
  onLoad: () => void;
  hasRun: boolean;
}) {
  const { timeline, position } = props;

  if (!props.hasRun) {
    return (
      <section className="panel px-4 py-3">
        <span className="panel-title">Time travel</span>
        <span className="text-sm ml-4" style={{ color: "var(--color-text-muted)" }}>
          Book a trip, then rewind it.
        </span>
      </section>
    );
  }

  if (timeline.length === 0) {
    return (
      <section className="panel px-4 py-3 flex items-center gap-4">
        <span className="panel-title">Time travel</span>
        <button onClick={props.onLoad} className="btn mono h-8">
          Load history
        </button>
      </section>
    );
  }

  const current = timeline[Math.min(position, timeline.length - 1)];

  return (
    <section className="panel px-4 py-3 flex items-center gap-4">
      <span className="panel-title shrink-0">Time travel</span>
      <input
        type="range"
        min={0}
        max={timeline.length - 1}
        value={position}
        onChange={(e) => props.onScrub(Number(e.target.value))}
        className="flex-1 accent-indigo-500"
        aria-label="Scrub through this booking's history"
      />
      <span className="mono text-xs shrink-0" style={{ color: "var(--color-text-secondary)" }}>
        {position + 1}/{timeline.length}
      </span>
      <span className="text-sm truncate max-w-[36ch]" title={current.summary}>
        {current.stepName || current.eventType}
        <span style={{ color: "var(--color-text-muted)" }}> — {current.summary}</span>
      </span>
    </section>
  );
}

// ─── Traveller pill ─────────────────────────────────────────────

export function TravelerPill({ name, onRename }: { name: string; onRename: (n: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="panel-title">You</span>
      <input
        value={name}
        onChange={(e) => onRename(e.target.value)}
        className="mono bg-transparent border px-2 py-1 w-24 text-xs"
        style={{ borderColor: "var(--color-border)", color: "var(--color-brand-text)" }}
        aria-label="Your traveller name"
      />
    </label>
  );
}
