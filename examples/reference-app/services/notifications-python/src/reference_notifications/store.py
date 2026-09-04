"""The local delivery log, its duplicate guard and its resume cursor.

One SQLite file, and one transaction across all three. That is the whole
durability story of this context: a crash between two of them would either
replay a delivery the log already holds or skip one it does not.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from types import TracebackType

SCHEMA = """
CREATE TABLE IF NOT EXISTS cursor (
    id       INTEGER PRIMARY KEY CHECK (id = 1),
    sequence INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deliveries (
    message_id      TEXT PRIMARY KEY,
    order_id        TEXT NOT NULL,
    status          TEXT NOT NULL,
    customer_email  TEXT NOT NULL,
    occurred_at     TEXT NOT NULL,
    sequence        INTEGER NOT NULL,
    delivered_at    TEXT NOT NULL,
    emitted         INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO cursor (id, sequence) VALUES (1, 0);
"""


@dataclass(frozen=True)
class Delivery:
    """One `notifications.order-status` message, as this context records it.

    `message_id` is derived by Ordering from the order and the status it
    announces, never from process-local randomness — which is what lets a
    redelivery be recognised here rather than guessed at.
    """

    message_id: str
    order_id: str
    status: str
    customer_email: str
    occurred_at: str
    sequence: int
    delivered_at: str


class NotificationStore:
    """The service's own database. Nothing else reads or writes it."""

    def __init__(self, connection: sqlite3.Connection) -> None:
        self._connection = connection

    @classmethod
    def open(cls, path: Path | str) -> NotificationStore:
        connection = sqlite3.connect(str(path), isolation_level=None)
        connection.row_factory = sqlite3.Row
        # WAL so a reader (a test, a curious presenter) never blocks the writer.
        connection.execute("PRAGMA journal_mode=WAL")
        connection.executescript(SCHEMA)
        return cls(connection)

    def close(self) -> None:
        self._connection.close()

    def __enter__(self) -> NotificationStore:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.close()

    def cursor(self) -> int:
        """The last stream sequence this service finished processing.

        0 on a fresh store, which is a position and not a placeholder: pub/sub
        `start_after_sequence` treats 0 as "from the very beginning", and setting
        the field at all is what opts the subscription into reconnecting.
        """
        row = self._connection.execute("SELECT sequence FROM cursor WHERE id = 1").fetchone()
        return int(row["sequence"])

    @contextmanager
    def transaction(self) -> Iterator[Callable[[Delivery], bool]]:
        """Records deliveries inside one transaction, rolled back on any error.

        `record` is its only caller, and it stays a seam anyway: the atomicity
        rule is the one claim this file makes that is worth proving, and a test
        can only prove it by failing *between* the delivery row and the cursor
        advance. Inlining BEGIN/COMMIT into `record` would take that away.

        The write callable returns False for a message already in the log. The
        cursor still advances for it: the message *is* processed, and a cursor
        that stalled on a duplicate would replay it after every reconnect.
        """
        self._connection.execute("BEGIN IMMEDIATE")
        try:
            yield self._write
        except BaseException:
            self._connection.execute("ROLLBACK")
            raise
        self._connection.execute("COMMIT")

    def record(self, delivery: Delivery) -> bool:
        """One delivery, committed on its own. Returns False for a redelivery."""
        with self.transaction() as write:
            return bool(write(delivery))

    def _write(self, delivery: Delivery) -> bool:
        inserted = self._connection.execute(
            """
            INSERT OR IGNORE INTO deliveries
                (message_id, order_id, status, customer_email, occurred_at,
                 sequence, delivered_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                delivery.message_id,
                delivery.order_id,
                delivery.status,
                delivery.customer_email,
                delivery.occurred_at,
                delivery.sequence,
                delivery.delivered_at,
            ),
        ).rowcount
        # max(), not an assignment: a resumed stream is at-least-once and can
        # redeliver an earlier frame, which must not rewind the cursor.
        self._connection.execute(
            "UPDATE cursor SET sequence = MAX(sequence, ?) WHERE id = 1", (delivery.sequence,)
        )
        return inserted == 1

    def deliveries(self) -> list[Delivery]:
        """The local delivery log, oldest first. This is the 'notification'."""
        return [
            self._row(row)
            for row in self._connection.execute(
                "SELECT * FROM deliveries ORDER BY sequence, message_id"
            )
        ]

    def unemitted(self) -> list[Delivery]:
        """Deliveries committed locally whose `notification.sent` was never acknowledged.

        The local commit comes first because it is the record that must not be
        lost; the emit is therefore at-least-once and this is the list that
        replays it after a crash in between.
        """
        return [
            self._row(row)
            for row in self._connection.execute(
                "SELECT * FROM deliveries WHERE emitted = 0 ORDER BY sequence, message_id"
            )
        ]

    def mark_emitted(self, message_id: str) -> None:
        self._connection.execute(
            "UPDATE deliveries SET emitted = 1 WHERE message_id = ?", (message_id,)
        )

    @staticmethod
    def _row(row: sqlite3.Row) -> Delivery:
        return Delivery(
            message_id=row["message_id"],
            order_id=row["order_id"],
            status=row["status"],
            customer_email=row["customer_email"],
            occurred_at=row["occurred_at"],
            sequence=int(row["sequence"]),
            delivered_at=row["delivered_at"],
        )
