// Shared domain contract — imported by BOTH the worker and the browser.
//
// The availability fold below has two readers: the `availability` projection
// reducer (what the UI shows) and `book-trip`'s seat check (what decides whether
// a booking is allowed). Those two MUST agree. If they drift, the UI says
// "1 seat left" while the function refuses to book, which reads as a race-
// condition bug and is miserable to debug. One function, two callers.

// ─── EVENT NAMES ────────────────────────────────────────────────

/** Command. The browser emits this; `book-trip` triggers on it. */
export const BOOKING_REQUESTED = "booking.requested";

/** Appended to `flight-{id}` and `hotel-{id}` entity streams. */
export const INVENTORY_EVENTS = {
  FlightSeeded: "flight.seeded",
  FlightSeatHeld: "flight.seat-held",
  FlightSeatReleased: "flight.seat-released",
  HotelSeeded: "hotel.seeded",
  HotelRoomHeld: "hotel.room-held",
  HotelRoomReleased: "hotel.room-released",
  /** Demo reset — restores inventory without destroying time-travel history. */
  InventoryReset: "inventory.reset",
} as const;

/** Appended to the `booking-{id}` entity stream. Drives the journey timeline. */
export const BOOKING_EVENTS = {
  Started: "booking.started",
  FlightReserved: "booking.flight-reserved",
  HotelReserved: "booking.hotel-reserved",
  Paid: "booking.paid",
  Confirmed: "booking.confirmed",
  Failed: "booking.failed",
  // Compensations. Per-step rather than one generic `booking.compensated`,
  // because the demo's whole point in beat 2 is watching each step unwind.
  FlightReleased: "booking.flight-released",
  HotelReleased: "booking.hotel-released",
  Refunded: "booking.refunded",
} as const;

export const PROJECTIONS = {
  Availability: "availability",
  Bookings: "bookings",
} as const;

// ─── SEED DATA ──────────────────────────────────────────────────
// Deliberately tiny (3 + 3, no search, no filter). UA100 ships with capacity 1
// — it is the contested seat that makes the race demo work.

export interface Flight {
  id: string;
  code: string;
  from: string;
  to: string;
  depart: string;
  price: number;
  capacity: number;
}

export interface Hotel {
  id: string;
  name: string;
  city: string;
  nights: number;
  price: number;
  rooms: number;
}

export const FLIGHTS: Flight[] = [
  { id: "UA100", code: "UA 100", from: "SFO", to: "NRT", depart: "09:45", price: 890, capacity: 1 },
  { id: "AA220", code: "AA 220", from: "SFO", to: "LHR", depart: "13:10", price: 640, capacity: 6 },
  { id: "DL318", code: "DL 318", from: "SFO", to: "CDG", depart: "18:30", price: 720, capacity: 4 },
];

export const HOTELS: Hotel[] = [
  { id: "hyatt-tokyo", name: "Park Hyatt", city: "Tokyo", nights: 4, price: 1240, rooms: 3 },
  { id: "savoy-london", name: "The Savoy", city: "London", nights: 3, price: 980, rooms: 5 },
  { id: "lutetia-paris", name: "Hôtel Lutetia", city: "Paris", nights: 3, price: 1100, rooms: 2 },
];

// ─── AVAILABILITY FOLD ──────────────────────────────────────────

export interface Availability {
  flights: Record<string, { held: number; capacity: number }>;
  hotels: Record<string, { held: number; rooms: number }>;
}

export function emptyAvailability(): Availability {
  return { flights: {}, hotels: {} };
}

interface FoldableEvent {
  name: string;
  data: unknown;
}

/**
 * Fold inventory events into current availability.
 *
 * Called by the `availability` projection reducer AND by `book-trip` when it
 * decides whether a seat is free. Must stay pure and idempotent — a projection
 * rebuild replays the whole stream through this.
 */
export function applyInventoryEvent(input: Availability, event: FoldableEvent): Availability {
  // A projection that has never seen an event reads back as `{}`, not as
  // initialState — so normalise here rather than making every caller guard.
  const state = normalizeAvailability(input);
  const data = (event.data ?? {}) as Record<string, unknown>;

  switch (event.name) {
    case INVENTORY_EVENTS.FlightSeeded: {
      const id = data.flightId as string;
      return {
        ...state,
        flights: { ...state.flights, [id]: { held: 0, capacity: data.capacity as number } },
      };
    }
    case INVENTORY_EVENTS.HotelSeeded: {
      const id = data.hotelId as string;
      return {
        ...state,
        hotels: { ...state.hotels, [id]: { held: 0, rooms: data.rooms as number } },
      };
    }
    case INVENTORY_EVENTS.FlightSeatHeld:
      return bumpFlight(state, data.flightId as string, +1);
    case INVENTORY_EVENTS.FlightSeatReleased:
      return bumpFlight(state, data.flightId as string, -1);
    case INVENTORY_EVENTS.HotelRoomHeld:
      return bumpHotel(state, data.hotelId as string, +1);
    case INVENTORY_EVENTS.HotelRoomReleased:
      return bumpHotel(state, data.hotelId as string, -1);

    case INVENTORY_EVENTS.InventoryReset: {
      // Reset zeroes the held counts but keeps capacities. The history stays on
      // the stream — this is why Reset is an event and not a database wipe.
      const flights = Object.fromEntries(
        Object.entries(state.flights).map(([id, f]) => [id, { ...f, held: 0 }]),
      );
      const hotels = Object.fromEntries(
        Object.entries(state.hotels).map(([id, h]) => [id, { ...h, held: 0 }]),
      );
      return { flights, hotels };
    }

    default:
      return state;
  }
}

function bumpFlight(state: Availability, id: string, delta: number): Availability {
  const current = state.flights[id];
  if (!current) return state;
  return {
    ...state,
    flights: { ...state.flights, [id]: { ...current, held: clamp(current.held + delta, current.capacity) } },
  };
}

function bumpHotel(state: Availability, id: string, delta: number): Availability {
  const current = state.hotels[id];
  if (!current) return state;
  return {
    ...state,
    hotels: { ...state.hotels, [id]: { ...current, held: clamp(current.held + delta, current.rooms) } },
  };
}

/** Held counts can never go below zero or above capacity, even on replay. */
function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(value, max));
}

/** Tolerates the `{}` an un-hydrated projection hands back. */
export function normalizeAvailability(state: Availability | undefined | null): Availability {
  return { flights: state?.flights ?? {}, hotels: state?.hotels ?? {} };
}

export function seatsLeft(state: Availability, flightId: string): number {
  const f = state?.flights?.[flightId];
  return f ? f.capacity - f.held : 0;
}

export function roomsLeft(state: Availability, hotelId: string): number {
  const h = state?.hotels?.[hotelId];
  return h ? h.rooms - h.held : 0;
}

// ─── BOOKING READ MODEL ─────────────────────────────────────────

export type BookingStatus = "running" | "confirmed" | "failed";

/** One line in the journey timeline. `undone: true` renders as a rewind. */
export interface BookingStep {
  name: string;
  label: string;
  undone: boolean;
}

export interface Booking {
  id: string;
  runId: string | null;
  traveler: string;
  flightId: string;
  hotelId: string;
  status: BookingStatus;
  failureReason: string | null;
  steps: BookingStep[];
  startedAt: string;
}

export interface BookingsState {
  bookings: Booking[];
}

const STEP_LABELS: Record<string, string> = {
  [BOOKING_EVENTS.FlightReserved]: "Reserve flight",
  [BOOKING_EVENTS.HotelReserved]: "Reserve hotel",
  [BOOKING_EVENTS.Paid]: "Charge card",
};

/** Compensation event → the forward step it undoes. */
const COMPENSATES: Record<string, string> = {
  [BOOKING_EVENTS.FlightReleased]: BOOKING_EVENTS.FlightReserved,
  [BOOKING_EVENTS.HotelReleased]: BOOKING_EVENTS.HotelReserved,
  [BOOKING_EVENTS.Refunded]: BOOKING_EVENTS.Paid,
};

export function applyBookingEvent(input: BookingsState, event: FoldableEvent): BookingsState {
  // Same `{}`-instead-of-initialState case as applyInventoryEvent.
  const state: BookingsState = { bookings: input?.bookings ?? [] };
  const data = (event.data ?? {}) as Record<string, unknown>;
  const bookingId = data.bookingId as string;
  if (!bookingId) return state;

  if (event.name === BOOKING_EVENTS.Started) {
    // Idempotent: a replayed Started must not duplicate the booking.
    if (state.bookings.some((b) => b.id === bookingId)) return state;
    const booking: Booking = {
      id: bookingId,
      runId: (data.runId as string) ?? null,
      traveler: (data.traveler as string) ?? "someone",
      flightId: data.flightId as string,
      hotelId: data.hotelId as string,
      status: "running",
      failureReason: null,
      steps: [],
      startedAt: (data.at as string) ?? "",
    };
    return { bookings: [booking, ...state.bookings] };
  }

  return {
    bookings: state.bookings.map((b) => (b.id === bookingId ? applyToBooking(b, event.name, data) : b)),
  };
}

function applyToBooking(b: Booking, name: string, data: Record<string, unknown>): Booking {
  if (STEP_LABELS[name]) {
    if (b.steps.some((s) => s.name === name)) return b;
    return { ...b, steps: [...b.steps, { name, label: STEP_LABELS[name], undone: false }] };
  }

  const undoes = COMPENSATES[name];
  if (undoes) {
    return { ...b, steps: b.steps.map((s) => (s.name === undoes ? { ...s, undone: true } : s)) };
  }

  if (name === BOOKING_EVENTS.Confirmed) return { ...b, status: "confirmed" };
  if (name === BOOKING_EVENTS.Failed) {
    return { ...b, status: "failed", failureReason: (data.reason as string) ?? "unknown" };
  }
  return b;
}
