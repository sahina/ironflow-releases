"""Loading side of the shared wire contract.

Mirrors `services/orders-go/internal/order/contracts.go` and
`services/payments-node/src/contracts.ts`. `contracts/` is language-neutral and
is never copied into a service, so this reads the committed files in place.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

#: The `$id` of contracts/schemas/common.v1.schema.json, minus the pointer.
COMMON_REF = "https://ironflow.run/reference-app/contracts/common.v1.schema.json#/$defs/"

#: The schemas this service registers. Notifications publishes exactly one fact.
OWNED_SCHEMAS: tuple[str, ...] = ("notification.sent",)

#: The topic this service consumes. Ordering publishes it; see CONTEXT-MAP.md.
TOPIC_ORDER_STATUS = "notifications.order-status"

#: The same topic as a subscription pattern.
#:
#: A publisher names a bare topic and the engine files it under the developer
#: pub/sub namespace (`pubsub.BuildUserTopicSubject`). A subscriber names the
#: namespace itself: a pattern with no known prefix is refused outright with
#: "invalid namespace prefix", which arrives as a stream that ends immediately
#: rather than as an error at subscribe time.
PATTERN_ORDER_STATUS = f"topic:{TOPIC_ORDER_STATUS}"

#: The fact this service publishes, and the producer label the read model reads
#: off its metadata to draw the timeline's language column.
EVENT_NOTIFICATION_SENT = "notification.sent"
PRODUCER = "notifications-python"

#: The one delivery channel this example has: a row in a local SQLite log.
CHANNEL = "local-log"


class ContractError(ValueError):
    """A payload that does not match the committed schema for its message."""


def find_contracts_dir() -> Path:
    """The absolute path of `contracts/`.

    REFERENCE_APP_CONTRACTS_DIR wins when set; otherwise this walks up from this
    file, which finds the same directory whether the service runs from a
    checkout or from an installed wheel inside it.
    """
    override = os.environ.get("REFERENCE_APP_CONTRACTS_DIR")
    if override:
        if not (Path(override) / "catalog.json").exists():
            raise ContractError(f"REFERENCE_APP_CONTRACTS_DIR={override} has no catalog.json")
        return Path(override)
    for directory in Path(__file__).resolve().parents:
        candidate = directory / "contracts"
        if (candidate / "catalog.json").exists():
            return candidate
    raise ContractError(
        "no contracts/catalog.json above this file; set REFERENCE_APP_CONTRACTS_DIR"
    )


def _read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise ContractError(f"no contract file at {path}")
    document: dict[str, Any] = json.loads(path.read_text())
    return document


def load_data_schema(contracts_dir: Path, name: str) -> dict[str, Any]:
    """One contract file, in the form the engine will accept.

    Two transformations, both forced by the engine and both explained in
    CONTEXT-MAP.md:

    * Only `properties.data` is registered. Ironflow carries data and metadata on
      separate channels, so the `{data, metadata}` envelope in the contract file
      is a test-time shape that no service ever emits.
    * External `$ref`s are inlined. The engine refuses external `$ref` resolution
      at registration time (`internal/schemacache/cache.go`), so a schema
      pointing at common.v1.schema.json by URL fails to compile.
    """
    envelope = _read_json(contracts_dir / "schemas" / f"{name}.v1.schema.json")
    data = envelope.get("properties", {}).get("data")
    if not isinstance(data, dict):
        raise ContractError(f"{name}.v1.schema.json has no properties.data")

    common_defs = _read_json(contracts_dir / "schemas" / "common.v1.schema.json").get("$defs")
    if not isinstance(common_defs, dict):
        raise ContractError("common.v1.schema.json has no $defs")

    used: dict[str, Any] = {}
    schema: dict[str, Any] = _inline_common_refs(data, common_defs, used)
    schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
    if used:
        schema["$defs"] = used
    return schema


def _inline_common_refs(node: Any, common_defs: dict[str, Any], used: dict[str, Any]) -> Any:
    """Rewrites every common.v1 `$ref` to a local pointer, collecting what it names.

    Any other external `$ref` is refused here rather than registered for the
    engine to reject.
    """
    if isinstance(node, list):
        return [_inline_common_refs(item, common_defs, used) for item in node]
    if not isinstance(node, dict):
        return node

    out: dict[str, Any] = {}
    for key, value in node.items():
        if key != "$ref":
            out[key] = _inline_common_refs(value, common_defs, used)
            continue
        ref = str(value)
        if not ref.startswith(COMMON_REF):
            if "://" in ref:
                raise ContractError(f"unsupported external $ref {ref}")
            out[key] = value
            continue
        def_name = ref[len(COMMON_REF) :]
        if def_name not in common_defs:
            raise ContractError(f"$ref names unknown common definition {def_name}")
        used[def_name] = common_defs[def_name]
        out[key] = f"#/$defs/{def_name}"
    return out


def validate_message(contracts_dir: Path, name: str, data: Any) -> None:
    """Checks one payload against the committed schema for its message.

    Applied to what arrives as well as to what this service emits: a subscriber
    that trusts the wire is the one that writes a malformed delivery to its own
    log and only finds out at the next release.
    """
    validator = Draft202012Validator(load_data_schema(contracts_dir, name))
    errors = sorted(validator.iter_errors(data), key=lambda error: list(error.path))
    if errors:
        detail = "; ".join(
            f"{'/'.join(str(p) for p in e.path) or '<root>'}: {e.message}" for e in errors
        )
        raise ContractError(f"{name} payload does not match its schema — {detail}")
