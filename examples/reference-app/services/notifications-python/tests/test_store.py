"""The local durability of one delivery.

The cursor advance, the delivery record and the processed mark are one
transaction, so a crash never loses a delivery and never records one twice.
"""

from dataclasses import replace
from pathlib import Path

import pytest

from reference_notifications.store import Delivery, NotificationStore

MESSAGE = Delivery(
    message_id="0f3b6c1d9a4e47b28c5d1e6f70a2b3c4:paid",
    order_id="0f3b6c1d9a4e47b28c5d1e6f70a2b3c4",
    status="paid",
    customer_email="ada@example.com",
    occurred_at="2026-08-28T10:01:06Z",
    sequence=7,
    delivered_at="2026-08-28T10:01:07Z",
)


@pytest.fixture
def store(tmp_path: Path):
    with NotificationStore.open(tmp_path / "notifications.db") as opened:
        yield opened


def test_a_fresh_store_resumes_from_the_beginning(store: NotificationStore) -> None:
    # 0, not None: `start_after_sequence` is both the cursor and the opt-in that
    # makes the SDK reconnect a dropped stream, and 0 means "from the very
    # beginning". Leaving it unset would silently end the stream on a drop.
    assert store.cursor() == 0


def test_a_first_delivery_is_recorded_and_advances_the_cursor(store: NotificationStore) -> None:
    assert store.record(MESSAGE) is True
    assert store.cursor() == 7
    assert [d.message_id for d in store.deliveries()] == ["0f3b6c1d9a4e47b28c5d1e6f70a2b3c4:paid"]


def test_a_redelivery_is_not_recorded_twice_but_still_advances(store: NotificationStore) -> None:
    store.record(MESSAGE)
    later = replace(MESSAGE, sequence=9, delivered_at="2026-08-28T10:02:00Z")
    assert store.record(later) is False
    assert len(store.deliveries()) == 1
    # The cursor still moves: the message is processed either way, and a cursor
    # that stuck on a duplicate would replay it forever after a reconnect.
    assert store.cursor() == 9


def test_the_cursor_never_moves_backwards(store: NotificationStore) -> None:
    store.record(replace(MESSAGE, sequence=12))
    store.record(
        replace(MESSAGE, 
            message_id="1a2b3c4d5e6f708192a3b4c5d6e7f809:paid",
            order_id="1a2b3c4d5e6f708192a3b4c5d6e7f809",
            sequence=4,
        )
    )
    assert store.cursor() == 12


def test_a_restart_resumes_from_the_persisted_cursor(tmp_path: Path) -> None:
    path = tmp_path / "notifications.db"
    with NotificationStore.open(path) as first:
        first.record(MESSAGE)
    with NotificationStore.open(path) as second:
        assert second.cursor() == 7
        # And the duplicate guard survives the restart, which is the whole point
        # of holding it next to the cursor rather than in memory.
        assert second.record(MESSAGE) is False


def test_a_failure_before_commit_leaves_no_trace(store: NotificationStore) -> None:
    with pytest.raises(RuntimeError, match="delivery failed"):
        with store.transaction() as write:
            write(MESSAGE)
            raise RuntimeError("delivery failed")
    assert store.cursor() == 0
    assert store.deliveries() == []
    # And the message is still new, so the reconnect redelivers and it lands.
    assert store.record(MESSAGE) is True


def test_a_delivery_committed_before_its_emit_is_acknowledged_is_re_emitted(
    store: NotificationStore,
) -> None:
    """The crash window between the local commit and the `notification.sent` emit.

    The commit is what must not be lost, so it happens first. The emit is
    therefore at-least-once, and this is how a lost one is found again.
    """
    store.record(MESSAGE)
    assert [d.message_id for d in store.unemitted()] == ["0f3b6c1d9a4e47b28c5d1e6f70a2b3c4:paid"]
    store.mark_emitted("0f3b6c1d9a4e47b28c5d1e6f70a2b3c4:paid")
    assert store.unemitted() == []
    # Idempotent: a second acknowledgement of the same delivery is not an error.
    store.mark_emitted("0f3b6c1d9a4e47b28c5d1e6f70a2b3c4:paid")
    assert store.unemitted() == []
