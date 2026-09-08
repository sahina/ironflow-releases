# Ironflow MCP Reference

The Ironflow MCP server lets AI agents interact with a running Ironflow instance via the
Model Context Protocol. Three modes:

- **Read-only** (default): list, get, query, and the operator read verbs — 23 tools
- **Read-write** (`--allow-writes`): + emit events, invoke functions, write secrets and KV, and
  the operator control verbs (resume, rebuild, requeue, reset) — 34 tools
- **Read-write with evidence** (`--allow-writes --evidence-file`): + the reload barrier — 35 tools

## Start MCP Server

```bash
ironflow mcp                       # read-only (23 tools)
ironflow mcp --allow-writes        # read + write (34 tools)
ironflow mcp --allow-writes --evidence-file trail.jsonl   # + ironflow_await_reload (35)
```

Other flags: `--server-url` (default `http://localhost:9123`), `--api-key`,
`--static-only` (exclude SDK-registered agent tools), `--transport stdio|streamable-http`.
With `--transport streamable-http`, `--host` (default `127.0.0.1`), `--port` (0 = OS
picks) and `--port-file` control the bind; stdio ignores all three.

## Configure in `.mcp.json`

```json
{
  "mcpServers": {
    "ironflow": {
      "command": "ironflow",
      "args": ["mcp", "--allow-writes"],
      "env": {
        "IRONFLOW_SERVER_URL": "http://localhost:9123",
        "IRONFLOW_API_KEY": "ifkey_..."
      }
    }
  }
}
```

## Tools (read-only) — 23, always registered

| Tool | Purpose |
|---|---|
| `ironflow_server_info` | Server health and version |
| `ironflow_overview` | Dashboard stats: function count, active runs, workers, recent events |
| `ironflow_list_runs` | List runs, with `limit`/`offset` paging |
| `ironflow_get_run` | Get run detail |
| `ironflow_get_run_steps` | Get a run's step outputs |
| `ironflow_list_functions` | List registered functions, with `limit`/`offset` paging |
| `ironflow_get_function` | Get function config |
| `ironflow_list_projections` | List projections, with `limit`/`offset` paging |
| `ironflow_projection_status` | Lag, errors, last event |
| `ironflow_list_entity_streams` | List entity streams, with `limit`/`offset` paging |
| `ironflow_read_entity_stream` | Read entity event history |
| `ironflow_list_events` | List events, with filters and keyset paging — see "Tailing the event feed" below |
| `ironflow_sql_query` | Run a read-only SQL query (`SELECT`, `WITH`, `EXPLAIN` only) |
| `ironflow_list_projects` | List projects |
| `ironflow_list_environments` | List environments |
| `ironflow_list_workers` | List connected pull-mode workers |
| `ironflow_list_secrets` | List secret names (no values) |
| `ironflow_kv_list_buckets` | List KV buckets |
| `ironflow_kv_list_keys` | List keys in a KV bucket |
| `ironflow_kv_get` | Read a KV value |
| `ironflow_rebuild_projection_status` | Progress of a rebuild job: events processed, ETA |
| `ironflow_outbox_dlq_list` | List outbox dead-letter entries (`env` required, must match the key's scope) |
| `ironflow_circuit_breaker_list` | List breakers and their state (closed/open/half-open) |

The last three are **diagnosis** verbs, deliberately available without
`--allow-writes`: an agent in read-only mode can see that dispatch is blocked or
that events are dead-lettered. Fixing either needs the write verbs below.

## Tools (write — requires `--allow-writes`) — 11

| Tool | Purpose |
|---|---|
| `ironflow_emit_event` | Emit an event (fire-and-forget — does **not** wait for the run) |
| `ironflow_invoke_function` | Invoke a function (fire-and-forget) |
| `ironflow_append_entity_event` | Append an event to an entity stream |
| `ironflow_secret_set` | Set a secret |
| `ironflow_kv_put` | Write a KV value |
| `ironflow_cancel_run` | Cancel a running workflow |
| `ironflow_resume_run` | Resume a paused **or failed** run — this is also the retry verb |
| `ironflow_rebuild_projection` | Start a projection rebuild. **Destructive** — deletes the read model and replays; there is no preview |
| `ironflow_outbox_dlq_requeue` | Requeue dead-letter rows — **every row sharing the `event_id`**, not one (`env` required) |
| `ironflow_outbox_dlq_discard` | Discard dead-letter rows permanently — **every row sharing the `event_id`**. Irreversible (`env` required) |
| `ironflow_circuit_breaker_reset` | Reset a breaker to closed, unblocking dispatch |

## Tools (reload barrier) — requires `--allow-writes` **and** `--evidence-file`

| Tool | Purpose |
|---|---|
| `ironflow_await_reload` | Wait for the dev server to re-register your functions past the version your last test hit |

If the evidence file can't be opened, the server logs a warning and serves without it —
so this tool won't appear even with both flags set. Check the path is writable.

There is no MCP tool for pausing a run, injecting step output, reading projection
state, or deleting a secret. Those are CLI-only — use `ironflow run pause`,
`ironflow run inject`, `ironflow projection get`, `ironflow secret delete`.

**Do not reach for the CLI when a tool exists.** In some hosts — Ironflow Desktop's
read mode among them — the shell is not available to you at all, and where it is,
the CLI defaults to `http://localhost:9123`, which may be a *different* engine from
the one your MCP tools are pointed at. A CLI command that appears to succeed against
the wrong engine is worse than one that is simply unavailable. Resuming a run and
rebuilding a projection both have tools now; use them.

Beyond these, the server also exposes **dynamic agent tools** registered by SDK
clients. The list is fetched **once at MCP-server startup** (best-effort — a fetch
failure logs a warning and leaves the static surface); there is no live
`tools/list_changed` push, so a tool an SDK registers afterwards appears only after
you restart the MCP server or IDE. Pass `--static-only` to exclude them.

### Tailing the event feed

`ironflow_list_events` forwards every filter `GET /api/v1/events` accepts:
`limit`, `cursor`, `before`, `name`, `names`, `search`, `source`, `since`, `until`.

An MCP tool call is request/response — it cannot stream into a turn — so a tail is
built by polling, not by watching.

**Use `since`, not the cursors.** Re-call with the timestamp of the newest event you
already have, and drop the duplicate boundary event:

```
ironflow_list_events(names: "order.placed,order.failed", limit: 50)
  -> { events: [ {id: "evt_9", timestamp: "2026-08-22T10:05:00.000Z"}, ... ] }
ironflow_list_events(names: "order.placed,order.failed", since: "2026-08-22T10:05:00.000Z")
  -> that event again, plus everything that arrived after it
```

**Drain the page before you advance the watermark.** `limit` is clamped to 200, and a
page returns the *newest* matches — so if more than a page arrived since your last poll,
advancing `since` to the newest timestamp you just saw skips the older excess **and you
never see it again**. While `has_next` is true, keep the same `since` and follow
`next_cursor`; only move `since` forward once the page set is drained.

Four things to know:

- **The cursors page backward through history, not forward into new arrivals.** The
  store orders `timestamp DESC`, so `cursor` matches `(timestamp, id) < token` and
  walks toward *older* events; `before` matches `>` and walks toward newer ones. The
  names suggest the opposite of what they do.
- A first call never returns `prev_cursor` (`has_prev` is false on a cold page), so a
  tail cannot be bootstrapped from the cursors at all. That is the other reason `since`
  is the answer.
- `cursor` and `before` are **mutually exclusive** — sending both is a 400.
- `name` is a substring match and is unindexed; `names` is an exact-match list.
  Prefer `names` when you know what you are looking for.

### Reload barrier: verify against the code you just wrote

When you edit a function or projection while a dev server with a file watcher
(`tsx watch`, `node --watch`, `air`, …) is running, the engine re-registers your
code with a bumped version. If you emit a test event before that reload lands, you
test the **old** code and get a misleading result.

To avoid it, after editing and before emitting a verification event:

```
edit code → ironflow_await_reload → ironflow_emit_event (or ironflow_invoke_function)
```

`ironflow_await_reload` blocks until the registry version passes the one your last
emit tested, then returns; it returns immediately if the reload already landed, and
returns after ~15s if none is detected (it never blocks the emit itself — it's an
advisory gate, not a hard lock).

## When to Use MCP vs CLI

- **MCP**: agent-driven workflows, integrated into AI sessions, programmatic access
- **CLI**: scripts, terminals, CI/CD, manual debugging

Skills like `/ironflow-ops` use MCP tools when present and fall back to CLI otherwise.

---

## Full Reference

- MCP server guide: https://docs.ironflow.run/how-to-guides/ai-mcp-server/
- CLI vs MCP: https://docs.ironflow.run/how-to-guides/ai-cli-vs-mcp/
