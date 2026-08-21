# Travel Booking — Ironflow Showcase

Book a flight and a hotel as one trip. Then break it on purpose.

This is the **90-second demo**: the app you put in front of someone who has never
heard of Ironflow. It is deliberately narrower than
[reference-app/](../reference-app/) — one story, one screen, no feature tour.

```text
booking.requested
       │
       ▼
┌──────────────────────────────────────────────┐
│  book-trip  (saga)                           │
│                                              │
│   reserve flight ──compensate──▶ release     │
│   reserve hotel  ──compensate──▶ release     │
│   charge card    ──compensate──▶ refund      │
└──────────────────────────────────────────────┘
       │                          │
       ▼                          ▼
  flight-{id} / hotel-{id}   booking-{id}
  (entity streams)           (entity stream)
       │                          │
       ▼                          ▼
  availability               bookings
  (projection)               (projection)
       │                          │
       └────────── UI subscribes ─┘
```

## Prerequisites

- Node.js 24+, pnpm
- Go 1.25+ (to build the Ironflow binary)

No `.env` setup needed — both the browser and the worker default to
`http://localhost:9123`, and the chaos control server to port 3100. Override with
`NEXT_PUBLIC_IRONFLOW_SERVER_URL`, `IRONFLOW_SERVER_URL` and `CHAOS_PORT` if you
need to (`.env.local` works, but it is gitignored, so you'd be creating it).

## Run

Every step says which directory it runs in. The first two are at the repo root,
the rest are here.

```bash
# ── repo root ───────────────────────────────────────────────
# 1. Build the binary. `make build` alone is NOT enough — the server
#    refuses to start without the embedded dashboard:
#      "embedded dashboard missing (static/index.html not found)"
make embed build

# 2. Start the server, and leave it running in this terminal.
./build/ironflow serve --dev

# ── examples/travel-booking (a second terminal) ──────────────
cd examples/travel-booking

# 3. Build the JS SDK. Without this, every @ironflow/* import is
#    untyped and `pnpm dev` fails.
pnpm -C ../../sdk/js build

# 4. Install this example.
pnpm install

# 5. Go.
pnpm dev
```

Open <http://localhost:3000>.

> **Don't `rm -rf node_modules` here without repairing the SDK afterwards.**
> Every example is its own little pnpm workspace that includes `../../sdk/js/*`,
> so `pnpm install` in this directory re-points the *shared* SDK packages at
> **this example's** store — `sdk/js/core/node_modules/typescript` becomes a
> symlink into `examples/travel-booking/node_modules/.pnpm/`. Delete that and the
> SDK build breaks for the whole repo, with a confusing
> `Cannot find module .../sdk/js/core/node_modules/typescript/bin/tsc`.
>
> A plain root `pnpm install` does **not** fix it — pnpm sees the links as
> current. Repair with:
>
> ```bash
> # from the repo root
> rm -rf sdk/js/*/node_modules
> pnpm install
> ```
>
> This is how every example behaves, not something specific to this one.

`pnpm dev` runs two processes: the Next.js UI and a **separate** worker process,
supervised by `scripts/dev.mjs`. The worker is separate on purpose — the best
moment in the demo is killing it, and you can't kill a worker embedded in your
own dev server.

## The 90 seconds

**Presenting this to someone?** [`presenter.html`](./presenter.html) walks the whole
thing without running anything. Each beat is a sequence of moments: the screen on the
left, what the engine just did and the code that did it on the right. Open it beside
the live app, or use it on its own when you can't run one — a laptop with no build, a
conference wifi, a slide slot. Arrow keys move between sections.

| #   | Do this                                                                                                  | Watch for                                                                                                                |
| --- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | Pick a flight and a hotel, hit **Book trip**                                                             | Three steps go green                                                                                                     |
| 2   | Hit **Fail payment**, book again                                                                         | Steps 1–2 green, step 3 red, then 1–2 strike through — hotel released, seat released, in reverse                         |
| —   | **Turn *Fail payment* back off** before continuing                                                       | The button loses its ✓. Skipping this breaks beat 4 — see the note under the table                                      |
| 4   | Pick **UA 100** (1 seat), hit **Simulate traveller**, wait for it to read *sold out*, then **Book trip** | "That seat just went. You weren't charged." No double-sell. (For the two-humans version, open a **new** tab — see below) |
| 5   | Hit **Load history**, drag the scrubber                                                                  | Every recorded moment of that run                                                                                        |

Beats 1, 2, 4 and 5 take about a minute together. **Beat 3 is not one of them** —
see below. The numbering keeps the gap on purpose so it matches the spec.

**Leaving *Fail payment* on going into beat 4 breaks it**, and confusingly. The
simulated traveller reserves the seat, its payment declines, and the compensation
hands the seat straight back — so UA 100 still reads "1 seat left" and there is
nothing to lose the race to. Worse, book during that window and you can still get
"That seat just went" from a version conflict with the in-flight compensation,
which looks right for entirely the wrong reason. Turn it off, and wait for the
card to read *sold out* before you book.

When you're done, hit **Reset inventory** and run it again. Reset appends an
event rather than wiping the database, so the time-travel history survives.

### Beat 3: crash-resume, and why it isn't 90 seconds

Hit **Slow payment**, book, then **Crash worker** mid-run. The worker light goes
red, the supervisor restarts the worker within about a second, and the run
eventually completes without re-running the steps that already finished.

"Eventually" is the honest word. **Measured on this example: about two minutes.**

```text
21:50:07  crash
21:50:10  supervisor has a new worker registered      (~3s)
21:51:42  capacity lease expires, segment recovered   (~95s)
21:52:12  run resumes and completes                   (~125s total)
```

The supervisor is not the bottleneck — the capacity lease is.
`internal/capacity/config.go` sets `LeaseExpiry: 90 * time.Second`, and the
engine won't hand the run to another worker until that lease lapses. There is no
YAML or env knob for it today, so this example can't tune it down.

So: run beat 3 as a "start it, talk over it, come back" demo, not as a
25-second beat. The guarantee it proves is real and worth showing — the
completed steps genuinely do not re-run, which you can confirm in the
time-travel history — but it does not fit a 90-second script.

### Beat 4 needs a genuinely new tab

Tab identity lives in `sessionStorage`, which is per-tab — unlike `localStorage`,
which every tab on the origin shares. But **duplicating** a tab copies
`sessionStorage` too, so "Duplicate Tab" gives you two of the same traveller and
the race looks broken. Open a new tab and type the URL, or rename yourself with
the pill in the top right.

## What this shows

| Ironflow feature            | Where                                                                 |
| --------------------------- | --------------------------------------------------------------------- |
| Entity streams              | `flight-{id}`, `hotel-{id}`, `booking-{id}`                           |
| Optimistic concurrency      | Two bookings append at the same expected version; one gets a conflict |
| Durable steps + memoization | Crash mid-run; completed steps don't re-run                           |
| `step.compensate()`         | Saga rollback, in reverse order                                       |
| Projections                 | `availability` and `bookings`, pushed live to the UI                  |
| Connection state            | `onConnectionChange` drives the status light                          |
| Offline write queue         | `createClient({ offlineQueue })` — IndexedDB outbox, drains on reconnect |
| Time travel                 | `getRunTimeline()` behind the scrubber                                |

Deliberately **not** shown, because [reference-app/](../reference-app/) already
covers them: cron, KV, pub/sub, config watch, upcasters, circuit breaker, AI
agents, `ironflow inspect`.

## Honest notes

- **Offline writes are not simulated any more.** The browser SDK gained a durable
  outbox in v0.28.0 (ADR 0053), so `lib/ironflow.ts` opts in with
  `createClient({ offlineQueue: { identity } })` and the app's own
  `localStorage` queue is gone. There is no "go offline" button, because a UI
  flag cannot exercise a real drain loop — use DevTools → Network → Offline,
  book a trip, and watch the outbox count. "Retry now" calls `queue.flush()`.
- **One outbox per traveller, keyed by display name.** `identity` and `dbName`
  both derive from the traveller, so two tabs under two names do not share a
  queue. Renaming does not rebuild the client — the tab keeps using the original
  outbox for the rest of the session. The next reload opens the new name's
  outbox instead, stranding anything still pending in the old one until you
  rename back. A real app would key on a stable user id, not a nickname.
- **Seat holds lock the whole flight stream, not one seat.** Two bookings on the
  same flight always serialise, even when there is plenty of room. Fine at demo
  scale; a real system would use per-seat reservation records. See the
  `ponytail:` comment in `worker.ts`.
- **The race loser fails rather than retrying.** A real airline would offer the
  next free seat. Failing cleanly is the clearer demo: no double-sell, no charge.
- **Crash-resume takes ~2 minutes, not seconds.** See the beat 3 section above
  for the measured breakdown. The capacity lease (90s, not configurable from
  outside the binary) is the gate.
- **The engine logs an audit error during crash-resume** — [#1601](https://github.com/sahina/ironflow/issues/1601).
  The four `capacity.*` audit event types aren't in the `audit_events.event_type`
  CHECK constraint, so the server logs `audit: failed to write event` when a
  lease lapses. Recovery still works; the audit rows are lost. Not caused by this
  example — you'll see it in the server log during beat 3.

## Check it still works

```bash
./scripts/demo-saga-rollback.sh
```

Starts a throwaway server and worker, declines a card, and asserts both
reservations were compensated and inventory came back to where it started.
Exits non-zero if the saga leaks a seat or a room.

Typecheck only: `pnpm typecheck`.
