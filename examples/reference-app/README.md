# Ironflow reference app

A small, realistic order-processing system built from four processes in three
languages, coordinated by one local Ironflow server. It is a reference system,
not a feature gallery: the domain is deliberately tiny so the coordination is
the thing you look at.

> **Under construction.** This example is being rebuilt in slices, tracked in
> [#1894](https://github.com/sahina/ironflow/issues/1894). The shared contracts
> and the launcher exist today: `make reference-app` starts a real engine on a
> discovered port and holds it open. The four application processes land in the
> following slices, so the components marked *(not yet)* do not start yet. The
> previous SDK feature gallery that lived here was removed; its history is in git.

## The system

| Component | Stack | Responsibility |
|---|---|---|
| Web *(not yet)* | Next.js, `@ironflow/browser` | Shop, operations view, system map, live state |
| Ordering *(not yet)* | Go SDK | Order stream, approval rules, durable wait, managed projection |
| Payments *(not yet)* | Node TypeScript SDK | Payment stream, durable authorize/capture, crash recovery |
| Notifications *(not yet)* | Python `ironflow-py` | Client-only subscriber with a persisted resume cursor |

The services never call each other over business HTTP. They communicate through
Ironflow commands, entity events, projections and Pub/Sub.

## What exists today

```text
contracts/
  schemas/       One JSON Schema per command, fact and notification message
  fixtures/      Valid and invalid payloads, plus index.json (the case manifest)
  catalog.json   The committed three-product catalog
  validate.mjs   The TypeScript-side contract test
scripts/
  dev.mjs        The supervisor: starts the engine, then every service
  control.mjs    The presenter crash control
  reset.mjs      The guarded delete
  test-live.mjs  The live gate, against the real engine binary
  lib/processes.mjs  Spawn, kill and the child table the services plug into
  lib/readiness.mjs  Poll-until helpers with one deadline and message each
  lib/control.mjs    The handshake file, the control plane, the delete guard
  lib/*.test.mjs     Unit tests, run by `make supervisor`
CONTEXT-MAP.md   Domain vocabulary, ownership, stream writers, causal rules
services/*/CONTEXT.md   One document per bounded context
```

`contracts/` is the cross-language source of truth. Go, TypeScript and Python
each validate the same fixtures against the same schemas, so a payload shape
cannot drift between languages. No fixture is ever copied into a service.

Two conventions worth knowing before you read the schemas:

- Each schema file is a `{data, metadata}` envelope. That envelope is a
  **test-time shape** — Ironflow carries data and metadata on separate channels,
  so a service registers the `properties.data` subschema, never the envelope.
- Fixtures under `fixtures/invalid/schema/` must be rejected by the schema.
  Fixtures under `fixtures/invalid/domain/` are well formed on the wire on
  purpose: only the ordering service, which holds the catalog, can reject them.

## Commands

Run these from the **repository root**; the two that start a server build the
engine first.

```bash
make reference-app                 # build and start the whole system; Ctrl-C stops it
make reference-app-crash-payment   # (not yet) from a second terminal: crash and restart the payment worker
make reference-app-reset           # delete examples/reference-app/.data and nothing else
make test-reference-app            # the fast gate: contracts, launcher tests, typecheck
make test-reference-app-live       # the live gate: the same launcher, the real engine
```

Run `make` **in this directory** for the workspace-only checks (`make contracts`,
`make supervisor`, `make check`).

## Running it

`make reference-app` picks nothing. The engine binds port `0` and reports the
port it was given; the supervisor reads it and passes that URL to every child
through the environment. Two checkouts can run at once, and there is no
configuration to edit.

Startup order is engine, then readiness, then services, then the web
application. A child that exits before it is ready fails the whole start with a
named reason rather than leaving you at a silent prompt.

Everything lives in `.data/`, which is git-ignored:

| Path | What it is |
|---|---|
| `ironflow.db`, `nats/` | Engine history. Survives restarts on purpose. |
| `bootstrap-key.json` | The admin key the engine writes on first boot. |
| `port.json` | The port the engine bound this run. |
| `supervisor.json` | The crash control's port and token, mode `0600`. |

Authentication stays **on**. The engine runs with a real bootstrap admin key
rather than `--dev`, which would leave an unauthenticated admin API on a
loopback port that any local process could drive. The supervisor holds that key
and hands it to the services; it never reaches browser code.

A normal run keeps its history. The **New demo session** control in the UI
filters what you see instead of deleting *(not yet)*. `make reference-app-reset`
is the only thing that deletes: it re-derives its target from its own location,
refuses anything that is not `examples/reference-app/.data`, refuses a symlink,
and refuses to run at all while the supervisor is alive.

## Reading order

Contracts first, then the services in the order events flow through them:
Ordering, Payments, Notifications, and the web application last.

## Not a production template

Direct browser commands and development bootstrap access are deliberate local
demo choices. Do not copy them into a production application.
