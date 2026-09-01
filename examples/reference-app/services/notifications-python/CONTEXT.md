# Notifications context

Python service. A client-only ConnectRPC subscriber, not an Ironflow worker runtime.
It hosts no functions and executes no steps. Shared vocabulary is in
[`../../CONTEXT-MAP.md`](../../CONTEXT-MAP.md).

## Responsibilities

- Subscribe to `notifications.order-status`, resuming after a sequence persisted in its
  own SQLite database.
- Record one human-readable local delivery per message.
- Emit `notification.sent` with a stable idempotency key.

## Rules this context enforces

- The cursor advance, the delivery record, and the processed-message mark happen in one
  local transaction, so a crash never loses or duplicates a delivery.
- A redelivered message is recognised by its stable message ID and is not recorded twice.
  A repeated emit attempt is stopped by Ironflow idempotency, not by luck.
- Notification success or failure never changes order state.

## Boundaries

- Writes no entity stream.
- Never calls another service over HTTP.
