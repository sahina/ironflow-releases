import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyBookingEvent, BOOKING_EVENTS, type Availability, type BookingsState,
} from "../domain";
import { waitForRollback, type RollbackSnapshot } from "./rollback-state";

const before: Availability = {
  flights: { AA220: { capacity: 6, held: 0 } },
  hotels: { "savoy-london": { rooms: 5, held: 0 } },
};
const held: Availability = {
  flights: { AA220: { capacity: 6, held: 1 } },
  hotels: { "savoy-london": { rooms: 5, held: 1 } },
};
const fresh = { availabilityLastEventId: "flight-release", flightReleaseEventId: "flight-release" };
const options = { bookingId: "test", flightId: "AA220", hotelId: "savoy-london", before, timeoutMs: 1000, pollMs: 1 };
let state: BookingsState = { bookings: [] };
function event(name: string) {
  state = applyBookingEvent(state, {
    name, data: { bookingId: "test", flightId: "AA220", hotelId: "savoy-london" },
  });
  return state.bookings[0];
}
event(BOOKING_EVENTS.Started);
event(BOOKING_EVENTS.FlightReserved);
event(BOOKING_EVENTS.HotelReserved);
const failed = event(BOOKING_EVENTS.Failed);
const hotelUndone = event(BOOKING_EVENTS.HotelReleased);
const bothUndone = event(BOOKING_EVENTS.FlightReleased);

test("waits for staged undo markers and independently delayed inventory", async () => {
  const samples: RollbackSnapshot[] = [
    { ...fresh, booking: undefined, availability: before },
    { ...fresh, booking: failed, availability: held },
    { ...fresh, booking: hotelUndone, availability: before },
    { ...fresh, booking: bothUndone, availability: held },
    { ...fresh, booking: bothUndone, availability: before },
  ];
  let reads = 0;
  await waitForRollback({ ...options, read: async () => samples[reads++] });
  assert.equal(reads, samples.length);
});

for (const [name, booking, availability, message] of [
  ["missing flight compensation", hotelUndone, before, /booking.flight-reserved undo marker missing/],
  ["missing hotel compensation", { ...bothUndone, steps: bothUndone.steps.map(s => s.name === BOOKING_EVENTS.HotelReserved ? { ...s, undone: false } : s) }, before, /booking.hotel-reserved undo marker missing/],
  ["seat leak", bothUndone, { ...before, flights: held.flights }, /seats: 6 before, 5 after/],
  ["room leak", bothUndone, { ...before, hotels: held.hotels }, /rooms: 5 before, 4 after/],
  ["over-restored inventory", bothUndone, { ...before, flights: { AA220: { capacity: 7, held: 0 } } }, /seats: 6 before, 7 after/],
  ["no booking", undefined, before, /booking has not failed/],
] as const) {
  test(name + " fails at the deadline", async () => {
    await assert.rejects(waitForRollback({
      ...options, timeoutMs: 10, read: async () => ({ ...fresh, booking, availability }),
    }), message);
  });
}

test("confirmed booking fails immediately", async () => {
  let reads = 0;
  await assert.rejects(waitForRollback({
    ...options, read: async () => {
      reads++;
      return { ...fresh, booking: { ...bothUndone, status: "confirmed" }, availability: before };
    },
  }), /confirmed despite a declined card/);
  assert.equal(reads, 1);
});

test("rejects a stale baseline with both undo markers before holds and restoration arrive", async () => {
  const samples: RollbackSnapshot[] = [
    { ...fresh, booking: bothUndone, availability: before, availabilityLastEventId: "seed" },
    { ...fresh, booking: bothUndone, availability: held, availabilityLastEventId: "hold" },
    { ...fresh, booking: bothUndone, availability: before },
  ];
  let reads = 0;
  await waitForRollback({ ...options, read: async () => samples[reads++] });
  assert.equal(reads, 3);
});

test("accepts fast rollback without observing transient holds", async () => {
  let reads = 0;
  await waitForRollback({ ...options, read: async () => {
    reads++;
    return { ...fresh, booking: bothUndone, availability: before };
  } });
  assert.equal(reads, 1);
});

for (const cursor of [
  { availabilityLastEventId: "seed", flightReleaseEventId: "flight-release" },
  { availabilityLastEventId: "", flightReleaseEventId: undefined },
]) {
  test(`restored counts cannot bypass release evidence ${JSON.stringify(cursor)}`, async () => {
    await assert.rejects(waitForRollback({
      ...options, timeoutMs: 10,
      read: async () => ({ ...cursor, booking: bothUndone, availability: before }),
    }), /availability has not processed the final inventory release/);
  });
}
