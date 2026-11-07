"""What this context does with one order-status message.

The decisions, separated from the ConnectRPC subscription and the REST emit that
surround them in main.py. Nothing here opens a socket.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from .contracts import (
    CHANNEL,
    EVENT_NOTIFICATION_SENT,
    PRODUCER,
    TOPIC_ORDER_STATUS,
    validate_message,
)
from .store import Delivery, NotificationStore

Emit = Callable[[str, dict[str, Any], dict[str, Any]], None]


@dataclass(frozen=True)
class Message:
    """One `notifications.order-status` message, with its stream position."""

    message_id: str
    order_id: str
    status: str
    customer_email: str
    occurred_at: str
    sequence: int

    def as_data(self) -> dict[str, Any]:
        return {
            "messageId": self.message_id,
            "orderId": self.order_id,
            "status": self.status,
            "customerEmail": self.customer_email,
            "occurredAt": self.occurred_at,
        }


@dataclass
class Deps:
    """The ports this context reaches the outside world through."""

    contracts_dir: Path
    store: NotificationStore
    emit: Emit
    now: Callable[[], str]


def parse_event(data: dict[str, Any] | None, *, sequence: int) -> Message:
    """One subscription frame, read into this context's own type.

    Nothing but the payload and the stream position is read. A topic message
    carries no demo session: Ordering publishes `{topic, data}` and the topic's
    committed schema has no session field. The UI filter is unaffected — the
    read model takes an order's session from `order.placed` and never overwrites
    it — so carrying an always-empty field here would be scaffolding for a value
    that does not exist.
    """
    payload = data or {}
    return Message(
        message_id=str(payload.get("messageId", "")),
        order_id=str(payload.get("orderId", "")),
        status=str(payload.get("status", "")),
        customer_email=str(payload.get("customerEmail", "")),
        occurred_at=str(payload.get("occurredAt", "")),
        sequence=sequence,
    )


def handle_message(deps: Deps, message: Message) -> bool:
    """Deliver one message. Returns False for a redelivery already in the log.

    Order matters twice here:

    * Validate before recording. A subscriber that trusts the wire writes the
      malformed delivery to its own log and finds out a release later.
    * Commit before emitting. The local delivery is the record that must not be
      lost; the emit is at-least-once and `resend_unacknowledged` closes the
      window a crash opens between them.
    """
    validate_message(deps.contracts_dir, TOPIC_ORDER_STATUS, message.as_data())

    # A Delivery is exactly a Message plus the moment it was delivered, so the
    # fields travel as one rather than being copied across seven lines.
    delivery = Delivery(**asdict(message), delivered_at=deps.now())
    if not deps.store.record(delivery):
        # Already delivered under this message ID. The cursor moved anyway, so a
        # reconnect does not hand it back forever.
        return False

    _announce(deps, delivery)
    return True


def resend_unacknowledged(deps: Deps) -> None:
    """Re-emit every delivery whose `notification.sent` was never acknowledged.

    Run at startup, before subscribing: a process killed between the local
    commit and the emit otherwise leaves a delivery the read model never hears
    about, and no later message would mention it.
    """
    for delivery in deps.store.unemitted():
        _announce(deps, delivery)


def _announce(deps: Deps, delivery: Delivery) -> None:
    fact = _fact(delivery)
    # What leaves is checked too, not only what arrives. The engine validates it
    # against the schema this service registered, so a drift caught here names
    # the field; caught there it is an emit that fails at a distance.
    validate_message(deps.contracts_dir, EVENT_NOTIFICATION_SENT, fact)
    deps.emit(EVENT_NOTIFICATION_SENT, fact, _metadata(delivery))
    # After the emit, so a crash in between leaves the delivery unacknowledged
    # and `resend_unacknowledged` replays it. This emitter does not supply an
    # idempotency key, so a replay can add a second timeline entry.
    deps.store.mark_emitted(delivery.message_id)


def _fact(delivery: Delivery) -> dict[str, Any]:
    return {
        "orderId": delivery.order_id,
        "messageId": delivery.message_id,
        "channel": CHANNEL,
        "status": delivery.status,
        "sentAt": delivery.delivered_at,
    }


def _metadata(delivery: Delivery) -> dict[str, Any]:
    """The metadata every fact this service writes carries.

    `producer` is load-bearing: the managed projection reads it to label the
    timeline entry's service and language (`projection.go: producerOf`).
    `causationId` is the message ID, which is the stable key this delivery is
    known by everywhere — in the topic message, in the local log, and here.
    """
    return {
        "correlationId": delivery.order_id,
        "causationId": delivery.message_id,
        "producer": PRODUCER,
    }
