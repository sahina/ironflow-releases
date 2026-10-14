// Asserts concurrent bookings on a flight with several seats are all honoured
// until the seats run out: N bookings race for S seats (1 < S < N), exactly S
// confirm, the rest fail as sold out, and the availability projection shows S
// holds. Guards holdInventory: when a stream version conflict was reported as
// "sold out", seats stayed free while bookings were rejected.
//
// Run via scripts/demo-saga-rollback.sh, which supplies the server and worker.

import { ironflow } from "@ironflow/browser";
import {
  BOOKING_REQUESTED,
  normalizeAvailability,
  PROJECTIONS,
  roomsLeft,
  seatsLeft,
  type Availability,
  type BookingsState,
} from "../domain";

const SERVER_URL = process.env.IRONFLOW_SERVER_URL ?? "http://localhost:9123";
const TIMEOUT_MS = Number(process.env.VERIFY_TIMEOUT_MS ?? 30_000);

// DL318 has 4 seats; savoy-london has 5 rooms, so rooms never run out first.
const FLIGHT_ID = "DL318";
const HOTEL_ID = "savoy-london";

ironflow.configure({ serverUrl: SERVER_URL });

function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function availability(): Promise<Availability> {
  const result = await ironflow.getProjection<Availability>(PROJECTIONS.Availability).catch(() => null);
  return normalizeAvailability(result?.state as Availability | undefined);
}

async function main(): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS;
  let before = await availability();
  while (seatsLeft(before, FLIGHT_ID) === 0 && Date.now() < deadline) {
    await sleep(250);
    before = await availability();
  }
  const seats = seatsLeft(before, FLIGHT_ID);
  if (seats < 2) fail(`${FLIGHT_ID} has ${seats} seat(s) left; need at least 2 (reset inventory first)`);
  if (roomsLeft(before, HOTEL_ID) < seats) fail(`${HOTEL_ID} has fewer rooms than ${FLIGHT_ID} has seats`);

  const total = seats + 2;
  const ids = Array.from({ length: total }, () => crypto.randomUUID());
  await Promise.all(
    ids.map((bookingId, i) =>
      ironflow.emit(BOOKING_REQUESTED, {
        bookingId,
        traveler: `contention-${i}`,
        flightId: FLIGHT_ID,
        hotelId: HOTEL_ID,
      }),
    ),
  );

  let confirmed = 0;
  let failed: { id: string; reason: string | null }[] = [];
  while (Date.now() < deadline) {
    const result = await ironflow.getProjection<BookingsState>(PROJECTIONS.Bookings).catch(() => null);
    const mine = (result?.state?.bookings ?? []).filter((b) => ids.includes(b.id));
    confirmed = mine.filter((b) => b.status === "confirmed").length;
    failed = mine.filter((b) => b.status === "failed").map((b) => ({ id: b.id, reason: b.failureReason }));
    if (confirmed + failed.length === total) break;
    await sleep(250);
  }
  if (confirmed + failed.length !== total) {
    fail(`only ${confirmed + failed.length} of ${total} bookings reached a terminal state in ${TIMEOUT_MS}ms`);
  }

  const wrong = failed.filter((f) => !f.reason?.includes("seat just went"));
  if (wrong.length) fail(`bookings failed for a reason other than sold out: ${wrong[0].reason}`);
  if (confirmed !== seats) {
    fail(`${total} bookings raced for ${seats} seats: ${confirmed} confirmed, ${failed.length} sold out (expected ${seats} confirmed)`);
  }

  // The projection trails the booking events, so wait for the holds to land.
  let held = -1;
  while (Date.now() < deadline) {
    held = seats - seatsLeft(await availability(), FLIGHT_ID);
    if (held === confirmed) break;
    await sleep(250);
  }
  if (held !== confirmed) fail(`${confirmed} bookings confirmed but ${FLIGHT_ID} shows ${held} seats held`);

  console.log(`✅ ${total} concurrent bookings on ${FLIGHT_ID}: ${confirmed} confirmed for ${seats} seats, ${failed.length} sold out, ${held} holds`);
  process.exit(0);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
