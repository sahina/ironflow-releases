# Adoption paths by stack

The section of the report that decides whether the reader trusts the rest of it.
It goes **before** the opportunities. The audience will verify every claim here in
week one, so all of it is checkable — and all of it now links to published docs.

Sources, in order of usefulness for a non-Go/TS team:

- <https://docs.ironflow.run/how-to-guides/integration/other-languages/> — the
  end-to-end guide: generating a client, registering a function, push mode at two
  levels, and the known gaps. Read it before writing this section of a report.
- <https://docs.ironflow.run/reference/api/push-protocol/> — the full push wire
  contract: request and response shapes, signature verification, step IDs and the
  escape function, memoization rules, yields and resume.
- <https://docs.ironflow.run/reference/sdk-comparison/> — the tier model.

**Do not restate these in the report.** Summarize in two or three sentences and
link. A report that reproduces a reference page goes stale the week it is written,
and the reader can follow a link.

## The tiers

**Tier 1 — Go and TypeScript.** Full worker runtime: durable-step memoization,
crash-resume replay, `sleep` / `waitForEvent` suspension, saga compensation, pull
mode. Hand-written, never generated.

> "Go and TypeScript are the only Tier-1 languages, and that limit is deliberate.
> No additional Tier-1 languages are planned." — `sdk-comparison.md`

**Tier 2 — Python today; Rust, C#, Java later.** Generated client, no worker
runtime. Functions still execute via **push mode**: the server POSTs to an HTTP
endpoint you own, which needs no runtime at all.

**No SDK.** Generate your own. Everything below applies.

## What to tell a Java, C#, or Rust shop

Three tiers, in this order. State all three; do not stop at the good news.

### 1. Calling Ironflow — available today, no SDK required

Generate from **both** published artifacts:

- `api/openapi.json` — OpenAPI 3.1, also served at `GET /api/v1/openapi.json`
- `api/proto/ironflow/v1/*.proto` — Buf, with first-class Java, C#, and Rust codegen

The OpenAPI artifact is **REST only** (ADR 0079; #1972 removed the REST twins of every
Connect route). It reaches event *reads*, KV with compare-and-set, config, secrets,
workers, and the whole ops/admin surface — DLQ, circuit breakers, capacity, API keys,
users, tenants, policies. On that ops surface the generated client is **wider than the
Go and Node SDKs**. Everything workflow-shaped is proto-only (next section).

`other-languages.md` carries a worked Kiota example and a "Known gaps in generated
clients" table — absent `servers`, under-declared `X-Ironflow-Environment`, no
enums on `status` and `yield.type`, and `register`/`heartbeat` accepting both POST
and PUT. Point the reader at that table rather than listing the gaps yourself.

### 2. Being called by Ironflow — push mode, a controller they already know

Ironflow POSTs to an endpoint they own: a Spring `@RestController`, an ASP.NET
controller, an axum handler. No runtime, no new dependency. This is the blessed
Tier-2 authoring path, and it is fully documented — `push-protocol.md` covers the
request and response shapes, HMAC verification, and, for durable steps, the step-ID
formula and memoization rules.

### 3. Pull mode — Go or TypeScript, permanently

Crash-resume, long sleeps and saga compensation over a long-running worker need the
Tier-1 runtime. In practice: a small Node or Go process beside their services,
holding the orchestration. **Their services stay Java.** That process calls them; it
does not replace them.

## Both generators, or the path dead-ends

**The workflow surface is ConnectRPC-only.** Emit, register/list/get/invoke functions,
list/get/cancel/resume runs and read their steps, entity streams, projections, event
schemas, publish, read-only SQL and webhook management have no REST route
(`other-languages.md` §"What the generated client does NOT reach"). A team that
generates from OpenAPI alone ends up with a client that can rotate API keys but cannot
emit an event. And a cron is a *field on the function*, so no registration means no
scheduled work either.

Always instruct both toolchains.

## Needs the proto toolchain

Emit; register a function; list/get/cancel/resume runs and read steps; register a
projection **and** the external projection worker loop; entity streams; event schemas;
publish; `ExecuteSQL`; `TriggerSync` and `TriggerBatch`; webhook mutation; `PauseRun`
and `InjectStepOutput`; agent tools.

## Unreachable from generated code, at any price

**A push subscription.** `api/openapi.json` contains zero streaming media types.
`PubSubService/Subscribe` and `JoinConsumerGroup` are server streams;
`SubscribeBidirectional` is served but returns `Unimplemented` by design. The
`GET /ws` and KV/config `/watch` upgrades are absent from the OpenAPI artifact
entirely.

Inbound means push mode: an endpoint they own. For a Spring shop that is a
controller, which is fine — but it is the only inbound door.

## Pull mode: the warning, and how to phrase it now

A generated client **will** contain `workers_register`, `workers_list_jobs` and
`workers_update_jobs`, fully typed. They look ready to use. `other-languages.md`
§"Pull mode is not supported outside Go and Node" says plainly that they are not
part of the supported surface, and lists the four traps — ack-before-execute, fence
echo on every mutating call, two response shapes, POST-or-PUT.

Phrase it as **unsupported, not undocumented.** The rules are published now; what is
missing is a runtime and anyone to support the result. The step ID is the
memoization key on both sides of the wire, and getting it wrong re-runs a step that
already completed — a double charge, silently. Recommending a Go or Node sidecar is
still the right call, and telling skeptical engineers not to build against your own
typed endpoints is the most credibility-earning sentence in the report.

## Gotchas to carry into the report

Keep this short and link out; `other-languages.md` has the full table.

- **`X-Ironflow-Environment` is under-declared in the spec.** Set it as a default
  header in the transport core or writes land in the default environment. Most
  likely first-week surprise.
- **Authenticate with a long-lived `ifkey_` bearer token.** The only login route in the
  spec is the platform-admin one (`/api/v1/platform/auth/login`); there is no tenant
  login, so a generated tenant client works from an API key.
- **No numbered `4xx`/`5xx` in the spec.** Every operation declares one typed
  `default` response of shape `{error, code, details}`. Handle that plus the status
  code.
- **Python installs as `ironflow-py`, not `ironflow`.** `pip install ironflow-py`
  from v0.33.1 (#1913); the import name stays `ironflow`. The bare name on PyPI is an
  unrelated materials-science package. Note the SDK is client-only — no worker runtime.
- **A first-party C# SDK was designed and closed** (so "C# later" above means "not
  planned", not "on the roadmap"). Issue #172, `NOT_PLANNED`:
  "speculative, no demand signal. Reopen if a .NET user materializes." If the reader
  is a .NET shop, they are the demand signal. Say so.
- Anything described as planned must be **labeled planned** — `PRODUCT.md`.

## Snippet rule (D14)

Every strong-fit snippet is **two-sided**:

- **Their side, in their language** — the service they already have, changed only at
  the line that emits, or the controller that receives the push.
- **The orchestration side, in TypeScript** — short, and always introduced as:
  *"your services stay Java; this is the 12-line orchestration file that sequences
  them."*

Never show a TypeScript snippet alone to a non-TypeScript codebase. The reader must
see their own language first, and must see that the TS file orchestrates rather than
replaces. For Node and Go readers this rule collapses to one snippet.
