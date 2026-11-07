// Asserts the saga compensates: a declined card must release the hotel room and
// the flight seat, and must leave inventory exactly where it started.
//
// Run via scripts/demo-saga-rollback.sh, which supplies the server and worker.

import { waitForRollback } from "./rollback-state";
import { ironflow } from "@ironflow/browser";
import {
  BOOKING_REQUESTED,
  INVENTORY_EVENTS,
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

async function availability(): Promise<Availability> {
  const result = await ironflow.getProjection<Availability>(PROJECTIONS.Availability);
  return normalizeAvailability(result.state);
}

/** Seeding races projection catch-up — wait for inventory to show up. */
async function waitForInventory(): Promise<Availability> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const state = await availability();
    if (seatsLeft(state, FLIGHT_ID) > 0 && roomsLeft(state, HOTEL_ID) > 0) return state;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`inventory for ${FLIGHT_ID}/${HOTEL_ID} never appeared in the availability projection`);
}

async function main(): Promise<void> {
  const before = await waitForInventory();
  console.log(JSON.stringify({ before }));

  await fetch(`${CHAOS_URL}/payment-mode?mode=fail`, { method: "POST" });

  const bookingId = crypto.randomUUID();
  try {
    await ironflow.emit(BOOKING_REQUESTED, {
      bookingId,
      traveler: "rollback-test",
      flightId: FLIGHT_ID,
      hotelId: HOTEL_ID,
    });

    await waitForRollback({
      bookingId,
      flightId: FLIGHT_ID,
      hotelId: HOTEL_ID,
      before,
      timeoutMs: TIMEOUT_MS,
      read: async () => {
        const result = await ironflow.getProjection<BookingsState>(PROJECTIONS.Bookings);
        const inventory = await ironflow.getProjection<Availability>(PROJECTIONS.Availability);
        // Hotel compensation precedes flight compensation. In this isolated demo,
        // the flight release is the final availability event until contention starts.
        const { events } = await ironflow.streams.read(`flight-${FLIGHT_ID}`);
        const release = events.find((event) =>
          event.name === INVENTORY_EVENTS.FlightSeatReleased && event.data.bookingId === bookingId,
        );
        return {
          availabilityLastEventId: inventory.lastEventId,
          flightReleaseEventId: release?.id,
          booking: result.state?.bookings?.find((b) => b.id === bookingId),
          availability: normalizeAvailability(inventory.state),
        };
      },
    });
    console.log("✅ payment failed, both reservations rolled back, inventory restored");
  } finally {
    await fetch(`${CHAOS_URL}/payment-mode?mode=normal`, { method: "POST" });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
