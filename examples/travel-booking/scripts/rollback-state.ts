import { BOOKING_EVENTS, roomsLeft, seatsLeft, type Availability, type Booking } from "../domain";

export interface RollbackSnapshot {
  booking: Booking | undefined;
  availability: Availability;
  availabilityLastEventId: string;
  flightReleaseEventId: string | undefined;
}

export async function waitForRollback(options: {
  bookingId: string;
  flightId: string;
  hotelId: string;
  before: Availability;
  read: () => Promise<RollbackSnapshot>;
  timeoutMs: number;
  pollMs?: number;
}): Promise<void> {
  const { bookingId, flightId, hotelId, before, read, timeoutMs, pollMs = 250 } = options;
  const deadline = Date.now() + timeoutMs;
  let pending = ["booking has not appeared"];
  let last: RollbackSnapshot | undefined;
  let previous = "";
  while (Date.now() < deadline) {
    last = await read();
    const serialized = JSON.stringify(last);
    if (serialized !== previous) {
      console.log(JSON.stringify({ bookingId, observedAt: new Date().toISOString(), ...last }));
      previous = serialized;
    }
    const { booking, availability } = last;
    if (booking?.status === "confirmed") throw new Error("booking confirmed despite a declined card");

    pending = [];
    if (booking?.status !== "failed") pending.push("booking has not failed");
    for (const name of [BOOKING_EVENTS.FlightReserved, BOOKING_EVENTS.HotelReserved]) {
      if (!booking?.steps.some((step) => step.name === name && step.undone)) {
        pending.push(`${name} undo marker missing`);
      }
    }
    if (!last.flightReleaseEventId || last.availabilityLastEventId !== last.flightReleaseEventId) {
      pending.push("availability has not processed the final inventory release");
    }
    const seatsBefore = seatsLeft(before, flightId);
    const roomsBefore = roomsLeft(before, hotelId);
    const seatsAfter = seatsLeft(availability, flightId);
    const roomsAfter = roomsLeft(availability, hotelId);
    if (seatsAfter !== seatsBefore) pending.push(`seats: ${seatsBefore} before, ${seatsAfter} after`);
    if (roomsAfter !== roomsBefore) pending.push(`rooms: ${roomsBefore} before, ${roomsAfter} after`);
    if (pending.length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, Math.max(0, deadline - Date.now()))));
  }
  throw new Error(`rollback ${bookingId} did not converge within ${timeoutMs}ms: ${pending.join("; ")}; last snapshot: ${JSON.stringify(last)}`);
}
