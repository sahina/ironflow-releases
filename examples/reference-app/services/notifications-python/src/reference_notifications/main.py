"""The Notifications context of the reference app.

A client-only ConnectRPC subscriber. It hosts no functions, executes no steps
and claims no worker slot — the Python SDK ships no worker runtime, and this
example is where that shape is shown off rather than worked around.

The supervisor (examples/reference-app/scripts/dev.mjs) starts it with
IRONFLOW_URL, IRONFLOW_API_KEY and REFERENCE_APP_DATA_DIR already pointing at the
engine and data directory it just created.

This file is the wiring. The decisions live in notifications.py, the durability
in store.py, and the shared wire contract in contracts.py.
"""

from __future__ import annotations

import json
import os
import signal
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path
from types import FrameType
from typing import Any

from ironflow import IronflowClient
from ironflow.rpc import IronflowRPC
from ironflow.rpc.v1 import SubscribeOptions, SubscribeRequest

from .contracts import (
    EVENT_NOTIFICATION_SENT,
    OWNED_SCHEMAS,
    PATTERN_ORDER_STATUS,
    find_contracts_dir,
    load_data_schema,
)
from .notifications import Deps, handle_message, parse_event, resend_unacknowledged
from .store import NotificationStore

#: Where `/system` and the supervisor look for proof this process is alive.
#:
#: It cannot be a worker record: the Python SDK registers none, and the engine
#: never removes one anyway (`internal/server/worker_rest.go` has no reaper), so
#: presence has to be a fresh timestamp rather than a row existing. It cannot be
#: the last `notification.sent` either — a system with no orders would read as a
#: dead subscriber.
HEARTBEAT_BUCKET = "reference-app"
HEARTBEAT_KEY = "notifications-heartbeat"

#: 3s, matching the payment worker's heartbeat interval. A presenter watching
#: `/system` should see this service appear and disappear at the same speed.
HEARTBEAT_INTERVAL_SECONDS = 3.0

#: How long to wait before re-subscribing after the stream ends or fails.
RECONNECT_DELAY_SECONDS = 1.0


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _log(message: str) -> None:
    sys.stderr.write(f"notifications: {message}\n")
    sys.stderr.flush()


def data_dir() -> Path:
    directory = os.environ.get("REFERENCE_APP_DATA_DIR")
    if not directory:
        raise RuntimeError(
            "REFERENCE_APP_DATA_DIR is unset — start the example with `make reference-app`"
        )
    return Path(directory)


def server_url() -> str:
    return (
        os.environ.get("IRONFLOW_URL")
        or os.environ.get("IRONFLOW_SERVER_URL")
        or "http://127.0.0.1:9123"
    )


def register_schemas(client: IronflowClient, contracts_dir: Path) -> None:
    """Idempotent: re-registering the same version with the same document is an
    upsert, so a restart is free."""
    for name in OWNED_SCHEMAS:
        # The released SDK pin predates the schema RPC facade. Its public
        # request method can send the same Connect JSON without a new dependency.
        client.request(
            "POST",
            "/ironflow.v1.EventSchemaService/RegisterSchema",
            body={
                "event_name": name,
                "version": 1,
                "schema_json": json.dumps(load_data_schema(contracts_dir, name)),
                "description": "Reference app notification delivery record",
            },
        )


def emitter(client: IronflowClient):  # type: ignore[no-untyped-def]
    def emit(name: str, data: dict[str, Any], metadata: dict[str, Any]) -> None:
        client.request(
            "POST",
            "/ironflow.v1.IronflowService/Emit",
            body={"event": name, "data": data, "metadata": metadata},
        )

    return emit


def start_heartbeat(client: IronflowClient, stop: threading.Event) -> threading.Thread:
    """Publishes a liveness timestamp into KV until `stop` is set.

    Best effort by design: a heartbeat that cannot be written is a status
    indicator that goes stale, never a subscriber that stops delivering.
    """
    try:
        client.kv_buckets({"name": HEARTBEAT_BUCKET, "description": "Reference app service status"})
    except Exception as error:  # noqa: BLE001 - 409 when it already exists, which is fine
        _log(f"heartbeat bucket: {error}")

    def beat() -> None:
        while not stop.is_set():
            try:
                client.kv_update_buckets_keys(
                    HEARTBEAT_BUCKET,
                    HEARTBEAT_KEY,
                    {"service": "notifications-python", "at": _now()},
                )
            except Exception as error:  # noqa: BLE001
                _log(f"heartbeat: {error}")
            stop.wait(HEARTBEAT_INTERVAL_SECONDS)

    thread = threading.Thread(target=beat, name="heartbeat", daemon=True)
    thread.start()
    return thread


def subscribe_forever(
    rpc: IronflowRPC,
    stop: threading.Event,
    *,
    contracts_dir: Path,
    db_path: Path,
    emit: Any,
) -> None:
    """Own the database, catch up, then deliver until stopped.

    The store is opened HERE rather than passed in. A SQLite connection belongs
    to the thread that created it — sqlite3 refuses it from any other — and this
    is the only thread that touches the delivery log.
    """
    with NotificationStore.open(db_path) as store:
        deps = Deps(contracts_dir=contracts_dir, store=store, emit=emit, now=_now)
        # Before subscribing: a process killed between the local commit and the
        # emit left a delivery the read model never heard about, and no later
        # message would mention it.
        resend_unacknowledged(deps)
        consume(rpc, deps, stop)


def consume(rpc: IronflowRPC, deps: Deps, stop: threading.Event) -> None:
    """Subscribe from the persisted cursor and deliver until stopped.

    `start_after_sequence` is set even on a fresh store, where it is 0 — "from
    the very beginning". The field is both the cursor and the opt-in that makes
    a dropped connection resume instead of silently ending the stream, so
    leaving it unset on the first boot would trade one for the other.
    """
    while not stop.is_set():
        after = deps.store.cursor()
        try:
            # Typed loosely: the SDK returns an Iterator, whose protocol has no
            # close(), while the object it returns does — and closing it is how
            # a stopped service lets go of the connection promptly.
            stream: Any = rpc.pubsub.subscribe(
                SubscribeRequest(
                    pattern=PATTERN_ORDER_STATUS,
                    options=SubscribeOptions(start_after_sequence=after),
                )
            )
            _log(f"subscribed to {PATTERN_ORDER_STATUS} after sequence {after}")
            for event in stream:
                if stop.is_set():
                    stream.close()
                    break
                deliver(deps, event)
        except Exception as error:  # noqa: BLE001 - any transport failure is a reconnect
            if stop.is_set():
                return
            _log(f"subscription ended ({error}); resuming from the persisted cursor")
        stop.wait(RECONNECT_DELAY_SECONDS)


def deliver(deps: Deps, event: Any) -> None:
    """One frame, read through its JSON form.

    `to_json()` renders the protobuf Structs the frame carries as plain values,
    which is the shape the schema and the store both want.
    """
    frame: dict[str, Any] = json.loads(event.to_json())
    message = parse_event(frame.get("data"), sequence=int(frame.get("sequence", 0)))
    try:
        if handle_message(deps, message):
            _log(f"delivered {message.status} for order {message.order_id}")
    except Exception as error:  # noqa: BLE001
        # A message this service cannot deliver must not stop the subscription:
        # notification failure never changes order state, and a stuck subscriber
        # would hide every later message behind one bad frame.
        _log(f"could not deliver {message.message_id}: {error}")


def main() -> None:
    contracts_dir = find_contracts_dir()
    url = server_url()
    api_key = os.environ.get("IRONFLOW_API_KEY") or None
    client = IronflowClient(server_url=url, api_key=api_key)

    # Registration comes before the first delivery, so no fact this service
    # publishes can race an unregistered schema.
    register_schemas(client, contracts_dir)

    stop = threading.Event()

    def shutdown(_signal: int, _frame: FrameType | None) -> None:
        stop.set()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    start_heartbeat(client, stop)

    rpc = IronflowRPC(server_url=url, api_key=api_key)
    sys.stdout.write(f"notifications ready — {EVENT_NOTIFICATION_SENT} registered\n")
    sys.stdout.flush()

    # On its own thread, so a signal stops this process promptly. The loop
    # blocks in `for event in stream` waiting for the next message, and a
    # handler that only sets `stop` could not interrupt it — a quiet system
    # would sit there until the supervisor escalated to SIGKILL.
    worker = threading.Thread(
        target=subscribe_forever,
        args=(rpc, stop),
        kwargs={
            "contracts_dir": contracts_dir,
            "db_path": data_dir() / "notifications.db",
            "emit": emitter(client),
        },
        name="subscription",
        daemon=True,
    )
    worker.start()
    try:
        while not stop.wait(1.0):
            if not worker.is_alive():
                # It only returns when stopped, so this is a failure it could
                # not recover from. Exiting lets the supervisor say so.
                raise RuntimeError("the subscription thread stopped unexpectedly")
    finally:
        stop.set()
        # Closes the transport out from under the blocked read, which is what
        # actually ends the thread. It is a daemon either way.
        rpc.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001
        _log(str(error))
        sys.exit(1)
