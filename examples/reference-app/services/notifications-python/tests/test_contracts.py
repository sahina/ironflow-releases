"""The Python side of the shared wire contract.

`contracts/` is language-neutral and is never copied into a service, so this
reads the committed files in place — the same `fixtures/index.json` manifest the
Go and TypeScript suites loop over, case for case.
"""

import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from reference_notifications.contracts import (
    OWNED_SCHEMAS,
    ContractError,
    find_contracts_dir,
    load_data_schema,
    validate_message,
)


@pytest.fixture(scope="module")
def contracts_dir() -> Path:
    return find_contracts_dir()


@pytest.fixture(scope="module")
def manifest(contracts_dir: Path) -> dict:
    return json.loads((contracts_dir / "fixtures" / "index.json").read_text())


@pytest.fixture(scope="module")
def registry(contracts_dir: Path) -> Registry:
    """Every schema file under its own `$id`, so cross-file `$ref`s resolve.

    This is the test-time view of the contract — the envelope as written. It is
    not the shape any service registers; see `load_data_schema`.
    """
    return Registry().with_resources(
        (json.loads(path.read_text())["$id"], Resource.from_contents(json.loads(path.read_text())))
        for path in sorted((contracts_dir / "schemas").glob("*.json"))
    )


def validator_for(
    contracts_dir: Path, registry: Registry, schema_file: str
) -> Draft202012Validator:
    schema = json.loads((contracts_dir / "schemas" / schema_file).read_text())
    return Draft202012Validator(schema, registry=registry)


EXPECTATIONS = {"valid", "schema-invalid", "domain-invalid"}


def test_every_manifest_case_behaves_as_the_manifest_says(
    contracts_dir: Path, manifest: dict, registry: Registry
) -> None:
    assert manifest["cases"], "the fixture manifest lists no cases"
    for case in manifest["cases"]:
        # An unknown expect value would otherwise fall through to the "expect
        # valid" branch and assert the opposite of what the case was written for.
        assert case["expect"] in EXPECTATIONS, (
            f"{case['fixture']}: unknown expect {case['expect']!r}"
        )
        payload = json.loads((contracts_dir / case["fixture"]).read_text())
        ok = validator_for(contracts_dir, registry, case["schema"]).is_valid(payload)
        if case["expect"] == "schema-invalid":
            assert not ok, f"{case['fixture']}: expected a schema violation ({case['reason']})"
        else:
            # domain-invalid payloads are well formed on the wire on purpose:
            # only Ordering, which holds the catalog, can reject them.
            assert ok, f"{case['fixture']}: expected valid"


def test_the_catalog_matches_its_own_schema(contracts_dir: Path, registry: Registry) -> None:
    schema = json.loads((contracts_dir / "catalog.schema.json").read_text())
    Draft202012Validator(schema, registry=registry).validate(
        json.loads((contracts_dir / "catalog.json").read_text())
    )


def test_owned_schemas_are_the_ones_this_service_publishes() -> None:
    assert OWNED_SCHEMAS == ("notification.sent",)


def test_load_data_schema_registers_the_data_subschema_only(contracts_dir: Path) -> None:
    schema = load_data_schema(contracts_dir, "notification.sent")
    # The `{data, metadata}` envelope is a test-time shape: Ironflow carries data
    # and metadata on separate channels, so registering the envelope would fail
    # every handler that validates its input.
    assert "metadata" not in schema["properties"]
    assert set(schema["properties"]) == {"orderId", "messageId", "channel", "status", "sentAt"}


def test_load_data_schema_inlines_external_refs(contracts_dir: Path) -> None:
    """The engine refuses external `$ref` resolution when it compiles a schema."""
    schema = load_data_schema(contracts_dir, "notification.sent")
    assert schema["properties"]["orderId"]["$ref"] == "#/$defs/entityId"
    assert "entityId" in schema["$defs"]
    # Compiles with no registry at all, which is what the engine will do.
    Draft202012Validator.check_schema(schema)
    Draft202012Validator(schema).validate(
        json.loads((contracts_dir / "fixtures" / "valid" / "notification.sent.json").read_text())[
            "data"
        ]
    )


def test_validate_message_accepts_the_committed_fixture(contracts_dir: Path) -> None:
    fixture = json.loads(
        (contracts_dir / "fixtures" / "valid" / "notifications.order-status.json").read_text()
    )
    validate_message(contracts_dir, "notifications.order-status", fixture["data"])


def test_validate_message_rejects_a_message_missing_its_id(contracts_dir: Path) -> None:
    fixture = json.loads(
        (contracts_dir / "fixtures" / "valid" / "notifications.order-status.json").read_text()
    )
    del fixture["data"]["messageId"]
    with pytest.raises(ContractError, match="notifications.order-status"):
        validate_message(contracts_dir, "notifications.order-status", fixture["data"])
