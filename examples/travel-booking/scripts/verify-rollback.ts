// Asserts the saga compensates: a declined card must release the hotel room and
// the flight seat, and must leave inventory exactly where it started.
//
// Run via scripts/demo-saga-rollback.sh, which supplies the server and worker.

import { ironflow } from "@ironflow/browser";
import {
  BOOKING_REQUESTED,
  normalizeAvailability,
  PROJECTIONS,
  seatsLeft,
  roomsLeft,
  type Availability,
  type BookingsState,
} from "../domain";

const SERVER_URL = process.env.IRONFLOW_SERVER_URL ?? "http://localhost:9123";
const CHAOS_URL = `http://localhost:${process.env.CHAOS_PORT ?? 3100}`;
const TIMEOUT_MS = Number(process.env.VERIFY_TIMEOUT_MS ?? 30_000);

// AA220 has capacity 6 and savoy-london has 5 rooms — deliberately not the
// contested flight, so this test measures rollback and not sold-out handling.
const FLIGHT_ID = "AA220";
const HOTEL_ID = "savoy-london";

ironflow.configure({ serverUrl: SERVER_URL });

function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

async function availability(): Promise<Availability> {
  const result = await ironflow.getProjection<Availability>(PROJECTIONS.Availability).catch(() => null);
  return normalizeAvailability(result?.state as Availability | undefined);
}

/** Seeding races projection catch-up — wait for inventory to show up. */
async function waitForInventory(): Promise<Availability> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const state = await availability();
    if (seatsLeft(state, FLIGHT_ID) > 0 && roomsLeft(state, HOTEL_ID) > 0) return state;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail(`inventory for ${FLIGHT_ID}/${HOTEL_ID} never appeared in the availability projection`);
}

async function main(): Promise<void> {
  const before = await waitForInventory();
  const seatsBefore = seatsLeft(before, FLIGHT_ID);
  const roomsBefore = roomsLeft(before, HOTEL_ID);

  await fetch(`${CHAOS_URL}/payment-mode?mode=fail`, { method: "POST" });

  const bookingId = crypto.randomUUID();
  await ironflow.emit(BOOKING_REQUESTED, {
    bookingId,
    traveler: "rollback-test",
    flightId: FLIGHT_ID,
    hotelId: HOTEL_ID,
  });

  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await ironflow.getProjection<BookingsState>(PROJECTIONS.Bookings).catch(() => null);
    const booking = result?.state?.bookings?.find((b) => b.id === bookingId);

    if (booking?.status === "failed") {
      const flightStep = booking.steps.find((s) => s.label === "Reserve flight");
      const hotelStep = booking.steps.find((s) => s.label === "Reserve hotel");

      if (!flightStep?.undone) fail("flight seat was never released — compensation did not run");
      if (!hotelStep?.undone) fail("hotel room was never released — compensation did not run");

      const after = await availability();
      const seatsAfter = seatsLeft(after, FLIGHT_ID);
      const roomsAfter = roomsLeft(after, HOTEL_ID);
      if (seatsAfter !== seatsBefore) fail(`seats leaked: ${seatsBefore} before, ${seatsAfter} after`);
      if (roomsAfter !== roomsBefore) fail(`rooms leaked: ${roomsBefore} before, ${roomsAfter} after`);

      console.log("✅ payment failed, both reservations rolled back, inventory restored");
      await fetch(`${CHAOS_URL}/payment-mode?mode=normal`, { method: "POST" });
      process.exit(0);
    }

    if (booking?.status === "confirmed") fail("booking confirmed despite a declined card");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  fail(`booking ${bookingId} never reached a terminal state within ${TIMEOUT_MS}ms`);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
