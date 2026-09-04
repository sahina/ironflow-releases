"""What this service does with one message, against a fake engine.

The subscription, the emit and the heartbeat are ports; these drive the decision
between them. The real ConnectRPC subscription is exercised by the live gate.
"""

from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest

from reference_notifications.contracts import ContractError, find_contracts_dir
from reference_notifications.notifications import (
    Deps,
    Message,
    handle_message,
    parse_event,
    resend_unacknowledged,
)
from reference_notifications.store import NotificationStore


class FakeEngine:
    """Records what was emitted. Raises on demand, to open the crash window."""

    def __init__(self) -> None:
        self.emitted: list[tuple[str, dict[str, Any], dict[str, Any]]] = []
        self.fail = False

    def emit(self, name: str, data: dict[str, Any], metadata: dict[str, Any]) -> None:
        if self.fail:
            raise RuntimeError("engine unreachable")
        self.emitted.append((name, data, metadata))


@pytest.fixture
def deps(tmp_path: Path):
    engine = FakeEngine()
    with NotificationStore.open(tmp_path / "notifications.db") as store:
        yield (
            Deps(
                contracts_dir=find_contracts_dir(),
                store=store,
                emit=engine.emit,
                now=lambda: "2026-08-28T10:01:07Z",
            ),
            engine,
        )


MESSAGE = Message(
    message_id="0f3b6c1d9a4e47b28c5d1e6f70a2b3c4:paid",
    order_id="0f3b6c1d9a4e47b28c5d1e6f70a2b3c4",
    status="paid",
    customer_email="ada@example.com",
    occurred_at="2026-08-28T10:01:06Z",
    sequence=7,
)


def test_a_first_message_is_logged_locally_and_announced(deps) -> None:
    d, engine = deps
    assert handle_message(d, MESSAGE) is True
    assert [entry.message_id for entry in d.store.deliveries()] == [
        "0f3b6c1d9a4e47b28c5d1e6f70a2b3c4:paid"
    ]
    name, data, metadata = engine.emitted[0]
    assert name == "notification.sent"
    assert data == {
        "orderId": "0f3b6c1d9a4e47b28c5d1e6f70a2b3c4",
        "messageId": "0f3b6c1d9a4e47b28c5d1e6f70a2b3c4:paid",
        "channel": "local-log",
        "status": "paid",
        "sentAt": "2026-08-28T10:01:07Z",
    }
    # The read model reads `producer` off the metadata to label the timeline's
    # language column; get it wrong and the entry is mislabeled with no error.
    assert metadata["producer"] == "notifications-python"
    assert metadata["correlationId"] == "0f3b6c1d9a4e47b28c5d1e6f70a2b3c4"
    assert metadata["causationId"] == "0f3b6c1d9a4e47b28c5d1e6f70a2b3c4:paid"


def test_the_emitted_fact_matches_its_own_committed_schema(deps) -> None:
    from reference_notifications.contracts import validate_message

    d, engine = deps
    handle_message(d, MESSAGE)
    validate_message(d.contracts_dir, "notification.sent", engine.emitted[0][1])


def test_a_redelivery_is_neither_logged_nor_announced_again(deps) -> None:
    d, engine = deps
    handle_message(d, MESSAGE)
    assert handle_message(d, replace(MESSAGE, sequence=9)) is False
    assert len(d.store.deliveries()) == 1
    assert len(engine.emitted) == 1
    assert d.store.cursor() == 9


def test_a_failed_emit_keeps_the_delivery_and_leaves_it_to_resend(deps) -> None:
    """The commit is the record that must not be lost, so it happens first."""
    d, engine = deps
    engine.fail = True
    with pytest.raises(RuntimeError, match="engine unreachable"):
        handle_message(d, MESSAGE)
    assert len(d.store.deliveries()) == 1
    assert [entry.message_id for entry in d.store.unemitted()] == [
        "0f3b6c1d9a4e47b28c5d1e6f70a2b3c4:paid"
    ]

    engine.fail = False
    resend_unacknowledged(d)
    assert [name for name, _, _ in engine.emitted] == ["notification.sent"]
    assert d.store.unemitted() == []


def test_resend_is_what_a_restart_runs_before_it_subscribes(deps) -> None:
    d, engine = deps
    resend_unacknowledged(d)
    assert engine.emitted == []


def test_a_message_that_does_not_match_the_schema_is_never_logged(deps) -> None:
    d, engine = deps
    with pytest.raises(ContractError, match="notifications.order-status"):
        handle_message(d, replace(MESSAGE, status="refunded"))
    assert d.store.deliveries() == []
    assert engine.emitted == []


def test_parse_event_reads_the_subscription_frame(deps) -> None:
    d, _ = deps
    message = parse_event(
        {
            "messageId": "1a2b3c4d5e6f708192a3b4c5d6e7f809:payment_failed",
            "orderId": "1a2b3c4d5e6f708192a3b4c5d6e7f809",
            "status": "payment_failed",
            "customerEmail": "grace@example.com",
            "occurredAt": "2026-08-28T10:05:00Z",
        },
        sequence=11,
    )
    assert message == Message(
        message_id="1a2b3c4d5e6f708192a3b4c5d6e7f809:payment_failed",
        order_id="1a2b3c4d5e6f708192a3b4c5d6e7f809",
        status="payment_failed",
        customer_email="grace@example.com",
        occurred_at="2026-08-28T10:05:00Z",
        sequence=11,
    )


def test_parse_event_tolerates_a_frame_with_no_payload(deps) -> None:
    # A frame this service cannot read must not crash the subscription; it is
    # refused by the schema a moment later, by name.
    message = parse_event(None, sequence=1)
    assert message == Message(
        message_id="", order_id="", status="", customer_email="", occurred_at="", sequence=1
    )
