# Ironflow reference app

A small, realistic order-processing system built from four processes in three
languages, coordinated by one local Ironflow server. It is a reference system,
not a feature gallery: the domain is deliberately tiny so the coordination is
the thing you look at.

## The system

| Component                 | Stack                        | Responsibility                                                 |
| ------------------------- | ---------------------------- | -------------------------------------------------------------- |
| Web                       | Next.js, `@ironflow/browser` | Shop, operations view, system map, live state                  |
| Ordering                  | Go SDK                       | Order stream, approval rules, durable wait, managed projection |
| Payments                  | Node TypeScript SDK          | Payment stream, durable authorize/capture, crash recovery      |
| Notifications             | Python `ironflow-py`         | Client-only subscriber with a persisted resume cursor          |

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
  test-crash-resume.mjs  The crash proof: kill the worker, read the gateway ledger
  test-walkthrough.mjs   The demo, driven in Chromium: place, approve, paid
  test-load.mjs      The opt-in load gate: a burst through all four processes
  lib/browser.mjs    The system Chromium the walkthrough drives
  lib/heartbeat.mjs  The KV liveness rule for the client-only Python subscriber
  lib/live.mjs       The harness all three live scripts share: boot, drive, tear down
  lib/processes.mjs  Spawn, kill and the child table the services plug into
  lib/readiness.mjs  Poll-until helpers with one deadline and message each
  lib/control.mjs    The handshake file, the control plane, the delete guard
  lib/*.test.mjs     Unit tests, run by `make supervisor`
apps/web/
  src/app/             /shop, /operations and /system
  src/components/      The views, the diagrams, and the provider that injects the client
  src/lib/             The catalog, the read model, the session, the status, the SDK adapter
services/orders-go/
  cmd/orders/          The pull-mode worker: registers schemas, then runs
  internal/order/      The domain, the stream seam, four functions, one projection
services/payments-node/
  src/main.ts          The pull-mode worker: registers schemas, then one function
  src/payment.ts       The domain: fold the payment stream, decide the next fact
  src/gateway.ts       The SQLite gateway simulator that makes a charge countable
  src/contracts.ts     The shared schemas, transformed into a registerable form
services/notifications-python/
  src/.../main.py            The wiring: schemas, KV heartbeat, the subscription loop
  src/.../notifications.py   What to do with one message: validate, commit, announce
  src/.../store.py           The cursor, the duplicate guard and the delivery log
  src/.../contracts.py       The same transformation, in Python
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

## The web application

`/shop` is the customer view, `/operations` the operator's, and `/system`
explains the architecture: a system map, live service status, the two sequences
and a link to each service's source. The browser sends `place.order` and `approve.order`
and reads the `orders` projection — it never folds a raw stream, and there is no
business HTTP API between the browser and the services.

The engine runs with authentication disabled, so the page talks to it directly
with no credential at all. That is a deliberate local-demo choice, labeled in the
UI on every screen, and it is not a production pattern: a real application
authenticates every call with a short-lived token from a trusted backend.

Two things a browser reveals that no unit test does, both fixed here and worth
knowing before you write a second Ironflow UI:

- `configure()` tears the client down — transport, open subscriptions, the
  drainer. Call it once per page, not once per component.
- Subscribe before the first read. The other order drops any update published
  while the subscription is still connecting.
- An effect that records "I have asked already" in **state** re-runs itself: the
  flag is one of its own dependencies, so setting it tears the effect down
  mid-request. It works against a fake that resolves in a microtask and never
  against a real engine. Keep that flag in a ref.

`/system` is careful about one thing worth copying: it distinguishes "not
running" from "not known". An engine the page cannot reach says nothing about
the processes behind it, and a subscription that has not answered yet is not a
broken one. Each row also states the evidence its claim rests on, because the
four processes prove they are alive in three different ways — and the Python
subscriber can use neither mechanism the others do.

## Prerequisites

The four processes need four toolchains, and `make reference-app` builds all
four before it starts anything. The fifth row is not one of them — nothing needs
a browser to run the demo, only to run the live gate:

| Tool | Version | Needed for |
| ---- | ------- | ---------- |
| Go | 1.26+ | The engine and the ordering service |
| Node.js | 24.2+ | The web application, the payment worker and the supervisor |
| pnpm | 10+ | Every JavaScript package here |
| Python | 3.10+ | The notification subscriber's virtualenv |
| Chrome, Chromium or Edge | any recent | `make test-reference-app-live` only — it drives the browser you already have |

Nothing else is configured. There is no database to create, no port to choose
and no `.env` to write.

## Commands

Run these from the **repository root**; the two that start a server build the
engine first.

```bash
make reference-app                 # build and start the whole system; Ctrl-C stops it
make reference-app-crash-payment   # from a second terminal: crash and restart the payment worker
make reference-app-reset           # delete examples/reference-app/.data and nothing else
make test-reference-app            # the fast gate: contracts, launcher tests, typecheck, builds, Go and Python tests
make test-reference-app-live       # the live gate, the crash proof and the Chromium walkthrough, against the real engine
make load-reference-app            # opt-in: put the system under a burst and report engine vs. app latency
```

`make load-reference-app` is in no CI gate. It places `LOAD_ORDERS` orders (200
by default) at `LOAD_RATE` a second, holds every one of them on the durable approval
wait, releases them at once, and reports what that cost — `make
load-reference-app LOAD_ORDERS=500 LOAD_RATE=50` to push it. It is not a throughput
benchmark: `make loadtest` at the repository root already measures the engine
with k6 against a committed baseline. What only this can see is the four
processes contending — three languages, two entity streams, a projection and an
at-least-once Python subscriber — and it gates on the properties that must hold
at any scale rather than on any timing. Read the header of
`scripts/test-load.mjs` before reading its numbers; the projection here is one
unpartitioned document by design, so its lane degrades first and is reported
separately for that reason.

Run `make` **in this directory** for the workspace-only checks (`make contracts`,
`make supervisor`, `make check`).

The live gate is three scripts, each booting the same supervisor against its own
fresh data directory:

| Script | What only it can prove |
| ------ | ---------------------- |
| `test-live.mjs` | The boot contract, and the two uninterrupted domain paths |
| `test-crash-resume.mjs` | One authorization survives a SIGKILLed worker, read from the gateway's ledger |
| `test-walkthrough.mjs` | What a person sees: a live subscription, a rendered diagram, a 404 |

`scripts/test-load.mjs` boots the same supervisor a fourth way and is in neither
gate; see **Commands** above.

The walkthrough shoots `/shop`, `/operations` and `/system` as it goes (the last
at both 1280px and 390px). They are **failure artifacts**: a passing run deletes
its whole data directory, screenshots included, and a failing one keeps all of
it and prints the path. It needs a Chrome, Chromium or Edge already installed —
`playwright-core` downloads none — or `REFERENCE_APP_BROWSER` set to one.

## Running it

`make reference-app` picks nothing. The engine binds port `0` and reports the
port it was given; the supervisor reads it and passes that URL to every child
through the environment. Two checkouts can run at once, and there is no
configuration to edit.

Startup order is engine, then readiness, then services, then the web
application. Each service reports ready by the strongest claim available to it:
the ordering service by the schemas it registered, the payment worker by a live
heartbeat on `GET /api/v1/workers`, and the Python subscriber by a timestamp it
rewrites in a KV bucket. The last one has no alternative — the Python SDK ships
no worker runtime, so that process appears in no worker list, and a registered
schema outlives the process that registered it.

A child that exits before it is ready fails the whole start with a named reason
rather than leaving you at a silent prompt.

Everything lives in `.data/`, which is git-ignored:

| Path                   | What it is                                                                 |
| ---------------------- | -------------------------------------------------------------------------- |
| `ironflow.db`, `nats/` | Engine history. Survives restarts on purpose.                              |
| `bootstrap-key.json`   | The admin key the engine writes on first boot. Unused while `--dev` is on. |
| `port.json`            | The port the engine bound this run.                                        |
| `supervisor.json`      | The crash control's port and token, mode `0600`.                           |
| `payments-gateway.db`  | The gateway simulator's ledger. One row per external side effect.          |
| `notifications.db`     | The delivery log, its duplicate guard and its resume cursor.                |

The engine runs in **dev mode** (`--dev`): no dashboard login, no API key. It
binds `127.0.0.1` only, and the alternative — an admin key in a file this same
user can read — gates nothing a local process could not already do, while making
a presenter sign in to their own demo. The key file is still written and still
handed to the services, so dropping `--dev` from `scripts/dev.mjs` restores
authentication with no other change.

Do not copy this for anything reachable beyond your machine.

A normal run keeps its history. The **New demo session** control in the UI
filters what you see instead of deleting: it rewrites one `localStorage` key, and
the order list shows only the orders whose `order.placed` carried that session. `make reference-app-reset`
is the only thing that deletes: it re-derives its target from its own location,
refuses anything that is not `examples/reference-app/.data`, refuses a symlink,
and refuses to run at all while the supervisor is alive.

## When it does not start

The supervisor fails loudly: a child that dies before it is ready takes the whole
start down and names itself. These are the six failures that are not its fault.

| What you see | What it means |
| ------------ | ------------- |
| `no engine binary at ... — run make embed build` | You started `pnpm dev` directly. `make reference-app` builds the engine first. |
| `embedded dashboard missing (static/index.html not found)` | The binary exists but was built by a bare `make build`, which bakes in whatever is already in `internal/server/static`. `make embed build`. |
| `no ordering binary at ...` / `no payment worker at ...` / `no notifications interpreter at ...` | Same cause, one service down: the build step did not run. `make -C examples/reference-app orders-build payments-build notifications-install`. |
| `<service> exited before it was ready` | That child died during startup. Its own output is above the line, tagged with its name. |
| `ERR_PNPM_OUTDATED_LOCKFILE` | A manifest changed without its lockfile. Run `pnpm install` in this directory and commit `pnpm-lock.yaml`. |
| `the reference app is running (pid N) — stop it before resetting` | `make reference-app-reset` will not delete data underneath a live system. Stop it with Ctrl-C first. |

A run that starts and then stalls is usually the durable wait, not a crash: an
order sits in **Waiting for approval** until somebody approves it, and a
`pm_crash` order sits at **Authorized** until you release it. `/system` reports
which processes are alive, and every timeline row links into the Ironflow
dashboard at the engine URL the supervisor printed, where the run and its steps
are visible in full.

## The three demo scenarios

The payment method token on the shop form picks what happens. Nothing else in
the system is scenario-aware: the ordering service, the projection and the UI
see one payment attempt either way.

| Choice                              | Token         | What the audience sees                                        |
| ----------------------------------- | ------------- | ------------------------------------------------------------- |
| Payment succeeds                    | `pm_success`  | Approve, then authorize, capture and `paid`, without stopping |
| Payment is declined                 | `pm_decline`  | Authorization is refused, the order ends `payment_failed`     |
| Payment worker crashes mid-flight   | `pm_crash`    | The card is held, then the run parks until you release it     |

### Running the crash scenario

1. Place a **Payment worker crashes mid-flight** order in `/shop` and approve it
   in `/operations`.
2. Wait until the payment row reads **Authorized**. `/operations` then prints the
   command to run and a Continue payment button.
3. Run `make reference-app-crash-payment` in a second terminal. The supervisor
   `SIGKILL`s only the payment worker and starts a replacement; `/operations`
   shows it leave and come back.
4. Click **Continue payment**. The replacement worker resumes the run from the
   memoized authorization, captures once, and the order reaches `paid`.

The card is never held twice. The run is parked on a durable wait when you kill
the worker, so it holds no claim and needs no timeout to recover — and the
authorization step is memoized, so the replacement never calls the gateway for
it. `scripts/test-crash-resume.mjs` asserts exactly that against the gateway's
own SQLite ledger: one authorization, one capture, and zero repeat presentations
of the authorization key.

## The Python subscriber

`services/notifications-python` is the odd one out on purpose: it is a
**client-only** process. The Python SDK ships no worker runtime, so it registers
no function, executes no step and claims no worker slot. All it does is
subscribe to a Pub/Sub topic over ConnectRPC, write one row per message to its
own SQLite database, and emit `notification.sent`.

That shape forces three things worth copying:

- The cursor, the delivery and the duplicate mark are one transaction. The local
  commit happens *before* the emit, because the delivery is the record that must
  not be lost — which makes the emit at-least-once, so a restart re-sends any
  delivery whose emit was never acknowledged.
- `start_after_sequence` is set even on a fresh store, where it is `0`. The field
  is both the cursor and the opt-in: without it the SDK ends a dropped
  subscription instead of resuming it.
- Liveness is a KV timestamp. Nothing else can report on a process that owns no
  worker record and may legitimately deliver nothing for minutes.

It pins `ironflow-py==0.33.1` from PyPI on purpose: this example proves the
released wheel works. A contributor changing `sdk/python` can override it in
their virtualenv with `pip install -e ../../../../sdk/python` after
`make notifications-install`.

## Reading order

Contracts first, then the services in the order events flow through them, and
the web application last. Each step below is one sitting.

1. **`contracts/`** — the wire. `schemas/order.placed.v1.schema.json` and
   `catalog.json` are enough to predict every payload in the system.
   `CONTEXT-MAP.md` names who may write which stream.
2. **`services/orders-go/internal/order/`** — the domain. `model.go` folds the
   stream and decides; `functions.go` is the four functions, including the
   durable approval wait; `projection.go` is the read model the browser sees.
3. **`services/payments-node/src/payment.ts`** — the same shape in TypeScript,
   plus `gateway.ts`, the external system that makes a duplicate charge
   countable, and the two durable steps in `main.ts` that a crash replays.
4. **`services/notifications-python/src/reference_notifications/`** — the
   client-only subscriber: `store.py` for the cursor and the duplicate guard,
   `notifications.py` for what happens to one message.
5. **`apps/web/src/`** — `lib/orders.ts` is the read model's shape,
   `components/shop.tsx` and `components/operations.tsx` send the two commands,
   and `components/app-shell.tsx` is the one place the SDK is configured.

`scripts/` is worth a sixth sitting only if you are copying the launcher:
`dev.mjs` starts everything, and `lib/live.mjs` is the harness the gates share.

## Not a production template

Direct browser commands and development bootstrap access are deliberate local
demo choices. Do not copy them into a production application.
