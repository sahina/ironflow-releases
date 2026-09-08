# Notifications context

Python service. A client-only ConnectRPC subscriber, not an Ironflow worker runtime.
It hosts no functions and executes no steps. Shared vocabulary is in
[`../../CONTEXT-MAP.md`](../../CONTEXT-MAP.md).

## Responsibilities

- Subscribe to `notifications.order-status`, resuming after a sequence persisted in its
  own SQLite database.
- Record one human-readable local delivery per message.
- Emit `notification.sent`, keyed by the same stable message ID.

## Rules this context enforces

- The cursor advance, the delivery record and the processed-message mark happen in one
  local transaction, so a crash never loses or duplicates a delivery.
- A redelivered message is recognised by its stable message ID — derived by Ordering
  from the order and the status it announces — and is not recorded twice.
- The local commit happens before the emit, because the delivery is the record that must
  not be lost. That makes the emit at-least-once, and `resend_unacknowledged` is what
  replays one lost to a crash in between.
- Notification success or failure never changes order state.

## Boundaries

- Writes no entity stream.
- Never calls another service over HTTP.

## Three things this service learned the hard way

1. **Notification delivery and notification facts have different guarantees.**
   A message ID identifies one delivery. Notification facts are at-least-once:
   a replay can add a second timeline entry while leaving the read model unchanged.
2. **Liveness cannot be a worker record or a registered schema.** The Python SDK ships no
   worker runtime, so this service appears nowhere in `GET /api/v1/workers`; and a
   registered schema outlives the process that registered it, so after the first boot
   that probe reports success for a service that is not running. It writes a timestamp
   into the `reference-app` KV bucket every few seconds instead, and the supervisor,
   the live scripts and `/system` all read that. The rule lives in
   `scripts/lib/heartbeat.mjs`, with the browser's copy in `apps/web/src/lib/heartbeat.ts`.
3. **`start_after_sequence` is the cursor *and* the opt-in.** The SDK reconnects a
   dropped subscription only when that field is set, so it is set even on a fresh store,
   where it is `0` — a position meaning "from the very beginning", not a placeholder.
   Leaving it unset on the first boot would trade resume for replay and end the stream
   silently on the first drop.

`demoSessionId` does not reach this service, and nothing here pretends otherwise.
Ordering's `Publish` carries `{topic, data}` only, and the topic's committed schema has
no session field — so the message type has no session field either, rather than an
always-empty one. The UI filter is unaffected: the read model takes an order's demo
session from `order.placed` and never overwrites it.
