import { createServer } from "node:http";
import {
  createClient,
  createFunction,
  createProjection,
  createWorker,
  NonRetryableError,
  type IronflowProjection,
} from "@ironflow/node";
import {
  applyBookingEvent,
  applyInventoryEvent,
  BOOKING_EVENTS,
  BOOKING_REQUESTED,
  emptyAvailability,
  FLIGHTS,
  HOTELS,
  INVENTORY_EVENTS,
  PROJECTIONS,
  roomsLeft,
  seatsLeft,
  type Availability,
  type BookingsState,
} from "./domain";

const ironflow = createClient();

const flightStream = (id: string) => `flight-${id}`;
const hotelStream = (id: string) => `hotel-${id}`;
const bookingStream = (id: string) => `booking-${id}`;

// ─── CHAOS STATE ────────────────────────────────────────────────
// In-memory on purpose: crashing the worker resets it, which is the honest
// behaviour — a fresh process has no memory of what you broke.

type PaymentMode = "normal" | "fail" | "slow";
let paymentMode: PaymentMode = "normal";
/** Flips once inventory is seeded and the worker is polling. */
let ready = false;
const SLOW_PAYMENT_MS = 8_000;

// ─── FUNCTION: book-trip (saga) ─────────────────────────────────
// reserve flight → reserve hotel → charge card, each with a compensation.
// A failure at any point unwinds the earlier steps in reverse.

interface BookingRequest {
  bookingId: string;
  traveler: string;
  flightId: string;
  hotelId: string;
}

const bookTrip = createFunction(
  {
    id: "book-trip",
    description:
      "Saga that books a flight and a hotel as one trip, then charges the card. Each step registers a compensation, so a later failure releases the seat and the room in reverse order. Seat holds use entity-stream optimistic concurrency, so two travellers racing for the last seat cannot both win.",
    triggers: [{ event: BOOKING_REQUESTED }],
    // Required for time-travel — without it there is no recorded history to scrub.
    recording: true,
  },
  async ({ event, step, run }) => {
    const req = event.data as BookingRequest;
    const stream = bookingStream(req.bookingId);

    await step.run("start-booking", async () =>
      appendBooking(stream, BOOKING_EVENTS.Started, {
        bookingId: req.bookingId,
        runId: run.id,
        traveler: req.traveler,
        flightId: req.flightId,
        hotelId: req.hotelId,
        at: new Date().toISOString(),
      }),
    );

    try {
      // ── Step 1: reserve the flight seat ──────────────────────
      await step.run("reserve-flight", async () => {
        await holdInventory({
          streamId: flightStream(req.flightId),
          entityType: "flight",
          heldEvent: INVENTORY_EVENTS.FlightSeatHeld,
          data: { flightId: req.flightId, bookingId: req.bookingId, traveler: req.traveler },
          hasCapacity: (a) => seatsLeft(a, req.flightId) > 0,
          soldOutMessage: "That seat just went. You weren't charged.",
        });
        return appendBooking(stream, BOOKING_EVENTS.FlightReserved, {
          bookingId: req.bookingId,
          flightId: req.flightId,
        });
      });

      step.compensate("reserve-flight", async () => {
        await releaseInventory({
          streamId: flightStream(req.flightId),
          entityType: "flight",
          releasedEvent: INVENTORY_EVENTS.FlightSeatReleased,
          data: { flightId: req.flightId, bookingId: req.bookingId },
        });
        await appendBooking(stream, BOOKING_EVENTS.FlightReleased, {
          bookingId: req.bookingId,
          flightId: req.flightId,
        });
      });

      // ── Step 2: reserve the hotel room ───────────────────────
      await step.run("reserve-hotel", async () => {
        await holdInventory({
          streamId: hotelStream(req.hotelId),
          entityType: "hotel",
          heldEvent: INVENTORY_EVENTS.HotelRoomHeld,
          data: { hotelId: req.hotelId, bookingId: req.bookingId, traveler: req.traveler },
          hasCapacity: (a) => roomsLeft(a, req.hotelId) > 0,
          soldOutMessage: "That hotel just sold out. You weren't charged.",
        });
        return appendBooking(stream, BOOKING_EVENTS.HotelReserved, {
          bookingId: req.bookingId,
          hotelId: req.hotelId,
        });
      });

      step.compensate("reserve-hotel", async () => {
        await releaseInventory({
          streamId: hotelStream(req.hotelId),
          entityType: "hotel",
          releasedEvent: INVENTORY_EVENTS.HotelRoomReleased,
          data: { hotelId: req.hotelId, bookingId: req.bookingId },
        });
        await appendBooking(stream, BOOKING_EVENTS.HotelReleased, {
          bookingId: req.bookingId,
          hotelId: req.hotelId,
        });
      });

      // ── Step 3: charge the card ──────────────────────────────
      await step.run("charge-card", async () => {
        if (paymentMode === "slow") {
          await new Promise((resolve) => setTimeout(resolve, SLOW_PAYMENT_MS));
        }
        if (paymentMode === "fail") {
          // NonRetryableError, not a bare throw: it tells the engine to skip the
          // retry schedule and fail now. A retried step would make the rollback
          // demo a backoff-watching exercise.
          throw new NonRetryableError("Card declined.");
        }
        return appendBooking(stream, BOOKING_EVENTS.Paid, {
          bookingId: req.bookingId,
          amount: priceOf(req),
        });
      });

      step.compensate("charge-card", async () => {
        await appendBooking(stream, BOOKING_EVENTS.Refunded, {
          bookingId: req.bookingId,
          amount: priceOf(req),
        });
      });

      await step.run("confirm-booking", async () =>
        appendBooking(stream, BOOKING_EVENTS.Confirmed, { bookingId: req.bookingId }),
      );

      return { bookingId: req.bookingId, status: "confirmed" };
    } catch (err) {
      // Record WHY it failed so the UI can say something human, then rethrow so
      // the engine runs the registered compensations in reverse order.
      await appendBooking(stream, BOOKING_EVENTS.Failed, {
        bookingId: req.bookingId,
        reason: err instanceof Error ? err.message : "Something went wrong.",
      });
      throw err;
    }
  },
);

// ─── INVENTORY HELPERS ──────────────────────────────────────────

interface HoldArgs {
  streamId: string;
  entityType: string;
  heldEvent: string;
  data: Record<string, unknown>;
  hasCapacity: (state: Availability) => boolean;
  soldOutMessage: string;
}

/**
 * Hold a unit of inventory, refusing if it's gone.
 *
 * The race lives here. Two travellers both read version 41, both see one seat
 * free, both append expecting 41 — the store fails the second with a version
 * conflict, so the seat cannot be sold twice.
 *
 * ponytail: optimistic concurrency on the whole stream, not per seat. Two
 * bookings for the *same* flight always serialise, even when there is plenty of
 * room — one of them just retries. Fine at demo scale; move to per-seat
 * reservation records if a real system needs concurrent holds on one flight.
 */
async function holdInventory(args: HoldArgs): Promise<void> {
  const info = await ironflow.streams.getInfo(args.streamId);
  if (!info) {
    throw new NonRetryableError(`Inventory stream ${args.streamId} is missing — run the seeder.`);
  }

  const state = await foldStream(args.streamId);
  if (!args.hasCapacity(state)) {
    throw new NonRetryableError(args.soldOutMessage);
  }

  try {
    await ironflow.streams.append(
      args.streamId,
      { entityType: args.entityType, name: args.heldEvent, data: args.data },
      { expectedVersion: info.version },
    );
  } catch (err) {
    if (isVersionConflict(err)) {
      throw new NonRetryableError(args.soldOutMessage);
    }
    throw err;
  }
}

interface ReleaseArgs {
  streamId: string;
  entityType: string;
  releasedEvent: string;
  data: Record<string, unknown>;
}

async function releaseInventory(args: ReleaseArgs): Promise<void> {
  // Re-read the head: compensations run after later steps may have moved the
  // version on, so the version captured during the forward step is stale.
  const info = await ironflow.streams.getInfo(args.streamId);
  if (!info) return;
  await ironflow.streams.append(
    args.streamId,
    { entityType: args.entityType, name: args.releasedEvent, data: args.data },
    { expectedVersion: info.version },
  );
}

/** Read a whole inventory stream and fold it with the shared reducer. */
async function foldStream(streamId: string): Promise<Availability> {
  const { events } = await ironflow.streams.read(streamId);
  return events.reduce(
    (state, e) => applyInventoryEvent(state, { name: e.name, data: e.data }),
    emptyAvailability(),
  );
}

async function appendBooking(streamId: string, name: string, data: Record<string, unknown>) {
  const info = await ironflow.streams.getInfo(streamId);
  return ironflow.streams.append(
    streamId,
    { entityType: "booking", name, data },
    { expectedVersion: info ? info.version : 0 },
  );
}

function isVersionConflict(err: unknown): boolean {
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return message.includes("version") && (message.includes("conflict") || message.includes("mismatch"));
}

function priceOf(req: BookingRequest): number {
  const flight = FLIGHTS.find((f) => f.id === req.flightId);
  const hotel = HOTELS.find((h) => h.id === req.hotelId);
  return (flight?.price ?? 0) + (hotel?.price ?? 0);
}

// ─── PROJECTIONS ────────────────────────────────────────────────

const availability = createProjection<Availability>({
  name: PROJECTIONS.Availability,
  events: Object.values(INVENTORY_EVENTS),
  initialState: emptyAvailability,
  // Same fold the booking function uses. Sharing it is the only way these two
  // readers can't disagree about how many seats are left.
  handler: applyInventoryEvent,
});

const bookings = createProjection<BookingsState>({
  name: PROJECTIONS.Bookings,
  events: Object.values(BOOKING_EVENTS),
  initialState: (): BookingsState => ({ bookings: [] }),
  handler: applyBookingEvent,
});

// ─── SEEDING ────────────────────────────────────────────────────
// Idempotent: a stream that already exists is left alone, so restarting the
// worker (or crashing it) never wipes inventory or history.

async function seedInventory(): Promise<void> {
  for (const flight of FLIGHTS) {
    const streamId = flightStream(flight.id);
    if (await ironflow.streams.getInfo(streamId)) continue;
    await ironflow.streams.append(
      streamId,
      {
        entityType: "flight",
        name: INVENTORY_EVENTS.FlightSeeded,
        data: { flightId: flight.id, capacity: flight.capacity },
      },
      { expectedVersion: 0 },
    );
  }

  for (const hotel of HOTELS) {
    const streamId = hotelStream(hotel.id);
    if (await ironflow.streams.getInfo(streamId)) continue;
    await ironflow.streams.append(
      streamId,
      {
        entityType: "hotel",
        name: INVENTORY_EVENTS.HotelSeeded,
        data: { hotelId: hotel.id, rooms: hotel.rooms },
      },
      { expectedVersion: 0 },
    );
  }
}

/** Restore inventory by appending a reset event — never by deleting history. */
async function resetInventory(): Promise<void> {
  for (const flight of FLIGHTS) {
    await appendReset(flightStream(flight.id), "flight");
  }
  for (const hotel of HOTELS) {
    await appendReset(hotelStream(hotel.id), "hotel");
  }
}

async function appendReset(streamId: string, entityType: string): Promise<void> {
  const info = await ironflow.streams.getInfo(streamId);
  if (!info) return;
  await ironflow.streams.append(
    streamId,
    { entityType, name: INVENTORY_EVENTS.InventoryReset, data: {} },
    { expectedVersion: info.version },
  );
}

// ─── CHAOS CONTROL ──────────────────────────────────────────────
// A tiny HTTP server inside the worker process. The browser can't kill a
// process, and the Next.js server can't kill a process it doesn't own — but the
// worker can always kill itself. The Next.js route at /api/chaos proxies here so
// the browser stays same-origin.

const CHAOS_PORT = Number(process.env.CHAOS_PORT ?? 3100);

function startChaosServer(): void {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    res.setHeader("Content-Type", "application/json");

    try {
      switch (url.pathname) {
        case "/crash":
          res.end(JSON.stringify({ ok: true, crashing: true }));
          console.log("[chaos] crashing worker on request");
          // Flush the response before dying, otherwise the caller sees a socket
          // error instead of an acknowledgement.
          setTimeout(() => process.exit(1), 50);
          return;

        case "/payment-mode": {
          const mode = url.searchParams.get("mode");
          if (mode !== "normal" && mode !== "fail" && mode !== "slow") {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: "mode must be normal, fail or slow" }));
            return;
          }
          paymentMode = mode;
          console.log(`[chaos] payment mode → ${mode}`);
          res.end(JSON.stringify({ ok: true, paymentMode }));
          return;
        }

        case "/reset":
          await resetInventory();
          paymentMode = "normal";
          console.log("[chaos] inventory reset");
          res.end(JSON.stringify({ ok: true }));
          return;

        case "/state":
          res.end(JSON.stringify({ ready, paymentMode, slowPaymentMs: SLOW_PAYMENT_MS }));
          return;

        default:
          res.statusCode = 404;
          res.end(JSON.stringify({ error: "not found" }));
      }
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : "chaos failed" }));
    }
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      // Without this handler the unhandled 'error' event kills the worker, the
      // supervisor restarts it, and it dies on the same port forever. Exit 2
      // instead — scripts/dev.mjs treats that as "don't restart".
      console.error(
        `[chaos] port ${CHAOS_PORT} is already in use — another copy of this worker is probably still running.`,
      );
      // Not "set it in .env.local" — that file is gitignored, so a fresh clone
      // doesn't have one to edit.
      console.error(`[chaos] kill it, or start with CHAOS_PORT=<free port> pnpm dev`);
      process.exit(2);
    }
    console.error("[chaos] control server failed:", err);
    process.exit(2);
  });

  server.listen(CHAOS_PORT, () => {
    console.log(`  Chaos control: http://localhost:${CHAOS_PORT}`);
  });
}

// ─── START ──────────────────────────────────────────────────────

const worker = createWorker({
  functions: [bookTrip],
  projections: [availability, bookings] as IronflowProjection[],
});

async function main(): Promise<void> {
  // Chaos control first, so "is the worker alive?" has an answer from the very
  // start — including while seeding is still running.
  startChaosServer();

  // Seed before accepting jobs, otherwise a booking can arrive for a flight
  // whose inventory stream doesn't exist yet.
  await seedInventory();

  // Deliberately not awaited: worker.start() resolves only once the poll loop
  // ends, so awaiting it here would mean the lines below never print and
  // `ready` would never flip.
  worker.start().catch((err) => {
    console.error("Travel booking worker failed to start:", err);
    process.exit(1);
  });

  ready = true;
  console.log("Travel booking worker started");
  console.log("  Command:     booking.requested");
  console.log("  Function:    book-trip (saga, 3 compensating steps)");
  console.log("  Projections: availability, bookings");
}

main().catch((err) => {
  console.error("Travel booking worker failed to start:", err);
  process.exit(1);
});
