# Ironflow CLI Reference

Only two flags are **persistent** (available on every command): `--as-org <org>` and
`-v/--verbose`. Everything else is per-command. `--json` is common but declared
individually — check the command. `--env` exists on a handful only (`secret`, `apikey
create`, `tenant`, `outbox dlq`, `capacity`, `debounce cancel`). There is **no
global `--project` flag** — the only `--project` in the CLI is on `env create`, and
`projection wait-for-event --projection` is a different flag.

Nearly every command that talks to a server takes `-s/--server` (default:
`IRONFLOW_SERVER_URL`, else `http://localhost:9123`).

## Emit & Invoke

```bash
ironflow emit order.placed --data '{"orderId":"ord_123","total":99.99}'
ironflow emit order.placed --data-file event.json --metadata source=cli
ironflow emit order.placed --data '{}' --wait --timeout 60s   # block on triggered runs
ironflow emit order.placed --data '{}' --version 2            # event schema version

ironflow invoke process-order --data '{"orderId":"ord_123"}' --json
ironflow invoke process-order --data '{}' --no-wait          # fire-and-forget
```

`invoke` **waits** for the run by default (`--timeout`, default 30s); `--no-wait` opts
out. `emit` is the opposite — fire-and-forget unless you pass `--wait`.

## Runs & Debug

```bash
ironflow run list                                     # recent runs
ironflow run list --status failed --limit 5 --json
ironflow run list --function process-order
ironflow run get <run-id> --json

# Control a live run (MCP equivalents: ironflow_cancel_run, ironflow_resume_run, ...)
ironflow run cancel <run-id> --reason "duplicate order"
ironflow run pause <run-id>                            # stops at next step boundary
ironflow run resume <run-id>                           # paused OR failed runs
ironflow run resume <run-id> --from-step charge
ironflow run paused-state <run-id> --json
ironflow run inject <run-id> <step-id> --output '{"ok":true}' --reason "patch bad API result"
```

Do not fire `run resume` twice in quick succession — a second in-flight resume returns
HTTP 409 rather than queueing.

```bash

# Time-travel debugger (requires recording: true)
ironflow inspect <run-id>                             # TUI
ironflow inspect <run-id> --replay                    # frame-by-frame
ironflow inspect <run-id> --at 2026-03-15T10:30:00Z   # snapshot mode
ironflow inspect <run-id> --replay --all-events
ironflow inspect <run-id> --dap                       # VS Code DAP
```

TUI: arrow keys navigate, Enter expand, `q` quit.

## Functions & Projections

```bash
ironflow function list --json
ironflow function get process-order --json

ironflow projection list --json
ironflow projection get order-stats --json --partition cust_1
ironflow projection status order-stats --json         # lag, errors, lastEventSeq
ironflow projection rebuild order-stats --dry-run      # scope only, changes nothing
ironflow projection rebuild order-stats                # DESTRUCTIVE: deletes + replays
ironflow projection rebuild order-stats --from <event-id> --to <event-id> --partition p1
ironflow projection rebuild cancel order-stats         # cancel an in-flight rebuild
ironflow projection pause order-stats
ironflow projection resume order-stats
ironflow projection delete order-stats
ironflow projection watch order-stats --replay 20      # live updates over WebSocket

# Read-your-writes: wait instead of polling
ironflow projection wait order-stats --min-seq 4211 --timeout 30s
ironflow projection wait order-stats --min-seq 4211 --stream        # long waits, heartbeats
ironflow projection wait-for-event <event-id> --projection order-stats
ironflow projection wait-batch --file items.json                    # or "-" for stdin

# JetStream durable maintenance (pre-#1516 leftovers)
ironflow projection durables prune          # list only
ironflow projection durables prune --delete
```

### SQL projections

Projections defined in SQL live entirely in the CLI — there is no SDK equivalent. The
name becomes the table name: lowercase, unquoted, ≤45 characters.

```bash
ironflow projection create board \
  --sql "CREATE TABLE proj_board (id TEXT PRIMARY KEY, title TEXT, status TEXT)" \
  --event "issue.created" --event "issue.status_changed" \
  --event-handler "issue.created=INSERT INTO proj_board (id, title, status) VALUES (:entity_id, :data.title, 'OPEN')" \
  --event-handler "issue.status_changed=UPDATE proj_board SET status = :data.to WHERE id = :entity_id"

ironflow projection create board --sql-file board.sql --event "issue.created" \
  --event-handler "issue.created=..."
```

## Entity Streams

```bash
ironflow stream list --json --type order --limit 50
ironflow stream read order-123 --json --from-version 10 --direction backward
ironflow stream info order-123 --json
ironflow stream append order-123 --type order --event order.placed \
  --data '{"total":99.99}' --expected-version 4 --idempotency-key ord-123-placed
ironflow stream subscribe order-123 --replay 20 --metadata
```

`stream append` publishes to both the entity topic and the events topic projections
consume — do **not** follow it with `ironflow emit` for the same fact, or the reducer
runs twice.

## Events, Schemas & Subscriptions

```bash
ironflow subscribe "order.>" "payment.*" --replay 50 --json --metadata

ironflow event schema register order.placed --version 2 --file schema.json
ironflow event schema list --json --event order.placed
ironflow event schema get order.placed --version 2 --json
ironflow event schema delete order.placed --version 1
ironflow event schema check order.placed --json    # is enforcement actually enforcing?
ironflow event upcast order.placed --from 1 --to 2 --data '{"name":"a b"}' --json
```

## Pub/Sub Topics

```bash
ironflow topic list --json
ironflow topic stats notifications --json
ironflow topic publish notifications --data '{"type":"order.shipped"}' \
  --idempotency-key ord-123-shipped
```

## Webhooks

```bash
ironflow webhook list --json
ironflow webhook deliveries --provider stripe --status rejected --limit 20 --json
ironflow webhook test --provider stripe --payload '{"type":"charge.succeeded"}' \
  --token ifwh_...      # required for sources created after migration 046
```

## Outbox (Dead-Letter Queue)

```bash
ironflow outbox dlq list --env production --limit 50 --offset 0 --json
ironflow outbox dlq requeue <event-id> --env production
ironflow outbox dlq discard <event-id> --env production --yes
```

`--env` is required unless `IRONFLOW_ENV` is set.

## Capacity & Debounce

```bash
ironflow capacity stats --json --env <env-id> --function process-order
ironflow capacity lanes    # also: queue, leases, buckets, sessions, credits
ironflow debounce list --json
ironflow debounce cancel process-order cust_42 --env <env-id>
```

`capacity` requires **platform** credentials (any platform principal — the view is global
across tenants). Set `IRONFLOW_API_KEY` to an `ifplatform_` key; a tenant `ifkey_` gets
`403 platform credentials required`.

## Skills

```bash
ironflow skills sync                 # write bundled skills to ~/.agents/skills
ironflow skills sync --local         # ...to ./.agents/skills in this project
ironflow skills sync --dest ./x --force
ironflow skills doctor               # detect agents, print wiring; changes nothing
```

## SQL Queries

```bash
ironflow sql "SELECT id, function_id, status, error FROM runs WHERE status='failed' ORDER BY started_at DESC LIMIT 10"
ironflow sql "SELECT step_id, status, error FROM steps WHERE run_id='<run-id>'"
ironflow sql "SELECT ..." --format json --max-rows 5000 --timeout 30000
```

`--format` is `table` (default), `json`, `csv` or `jsonl`; `--max-rows` defaults to 1000
and `--timeout` to 5000ms. Parsing output means passing `--format json`.

## Secrets

```bash
ironflow secret set stripe-key sk_live_abc123
ironflow secret get stripe-key
ironflow secret list                                   # names only
ironflow secret delete stripe-key
ironflow secret set stripe-key sk_test_xyz --env staging
```

In code: `ctx.secrets.get("stripe-key")`.

## API Keys

```bash
ironflow apikey create my-app-key                      # tenant key (ifkey_); name is positional
ironflow apikey create admin-key --platform            # platform key (ifplatform_)
ironflow apikey list --json
ironflow apikey rotate <key-id> --json                 # new value, same key record
ironflow apikey delete <key-id>
```

## Server

```bash
ironflow serve                                          # localhost:9123, SQLite, embedded NATS
ironflow serve --dev                                    # bypasses ALL auth — local work only
ironflow serve --dev --reset                            # wipe local state first (SQLite only)
ironflow serve --port 9000 --db ./my.db --host 127.0.0.1
IRONFLOW_DATABASE_URL="postgres://..." ironflow serve   # PostgreSQL
ironflow serve --nats-url nats://nats:4222 --node-id node-1   # cluster mode
ironflow serve --pprof                                  # debug endpoints on :6060
ironflow version
ironflow server info --json               # version, health, uptime, resource counts
ironflow config init > ironflow.yaml      # starter config; --kind cluster|platform, --prod
ironflow validate -f ironflow.yaml        # -f is required; there is no positional form
```

> **`-f` makes the YAML file the sole source of truth.** With `-f`, environment
> variables like `NATS_URL`, `NATS_CREDS_FILE`, `IRONFLOW_NODE_ID` and
> `IRONFLOW_STALE_CLAIM_THRESHOLD` are **not read**. Set the YAML field, or reference the
> variable inside the file as `${VAR}`. `serve` and `validate` warn once per variable
> that was set and ignored.

Dashboard: http://localhost:9123

`serve` writes local state to `.ironflow/` in the cwd: the SQLite db, the embedded NATS
store, `blobs/`, plus `.ironflow_bootstrap_key.json` (an admin API key) and
`.ironflow_jwt_secret`. Gitignore it — `ironflow init` templates already do. Setting
`spec.storage.path` relocates all five to that file's directory.

## Projects & Environments

```bash
ironflow project list --json
ironflow project create my-service
ironflow project delete proj_abc123        # takes the project ID, not the name
ironflow env list                          # no --json on this one
ironflow env create staging --project proj_abc123
ironflow env delete env_abc123             # takes the environment ID, not the name
```

## Deploy & Provision (Helm/Terraform Wrappers)

```bash
ironflow deploy --template small --name dev
ironflow deploy --template medium --name staging
ironflow deploy --template large --name prod \
  --set externalDatabase.url=postgres://... \
  --set externalNats.url=nats://...
ironflow deploy upgrade --template medium --name staging
ironflow deploy status --name staging --watch
ironflow deploy delete --name staging

# Single VPS over SSH — no Kubernetes, no Helm
ironflow deploy vps --host root@1.2.3.4 --domain ironflow.example.com --email me@example.com
ironflow deploy vps --host root@1.2.3.4 --port 9123 --version latest

ironflow provision create --provider hetzner --template medium --name ironflow
ironflow provision create --provider k3d --template small --name dev
ironflow provision status --provider hetzner --name ironflow
ironflow provision destroy --provider hetzner --name ironflow
```

## Scaffolding

```bash
ironflow init my-app                              # TypeScript (default)
ironflow init my-app --template go-quickstart
```

## MCP Server

```bash
ironflow mcp                                       # read-only
ironflow mcp --allow-writes                        # read + write
```

`.mcp.json`:
```json
{
  "mcpServers": {
    "ironflow": { "command": "ironflow", "args": ["mcp", "--allow-writes"] }
  }
}
```

## Circuit Breakers

```bash
ironflow circuit-breaker list
ironflow circuit-breaker reset <function-id-or-key>
```

## Multi-tenant (orgs, roles, policies, audit)

```bash
ironflow org list --json
ironflow org create my-org
ironflow org get org_abc123 --json
ironflow org delete org_abc123                # takes the org ID, not the name

ironflow tenant list --json
# One call creates org + built-in roles + environment + admin API key.
ironflow tenant provision --name "Acme Corp"
ironflow tenant provision --name "Acme Corp" --env staging   # default: production

ironflow audit trail <run-id> --json                 # run event trail
ironflow audit auth-trail --org org_default --json   # auth decision trail
```

### Roles (Layer 1 RBAC)

```bash
ironflow role list --json
ironflow role create admin --org org_abc123      # --org is required
ironflow role get role_abc123 --json
ironflow role assign-policy role_abc123 pol_xyz789
ironflow role remove-policy role_abc123 pol_xyz789
ironflow role delete role_abc123
```

### Policies (Layer 2 CEL)

**CEL policies are subtractive only.** Roles grant; policies can only narrow, deny-wins.
`--effect allow` is rejected at write (#943, ADR 0016 T2) — grant with a role, then add
conditional denies here.

```bash
ironflow policy list --json
ironflow policy get pol_abc123 --json
ironflow policy create --name deny-prod-delete --effect deny \
  --actions "delete" --resources "irn:org:acme:*" \
  --condition 'request.environment == "production"'

# Compile + evaluate without persisting. Use before create/update.
ironflow policy test --condition 'subject.org == "acme"' \
  --request '{"action":"read"}' --subject '{"id":"u1","roles":["admin"]}'
ironflow policy test --policy-id pol_abc123 --request-file req.json --subject-file sub.json

ironflow policy update pol_abc123 --condition "subject.org == 'acme'"
ironflow policy update pol_abc123 --clear-condition     # removes the condition
ironflow policy delete pol_abc123

# History is append-only: rollback forward-saves the old snapshot as a new version.
ironflow policy versions list pol_abc123 --json
ironflow policy rollback pol_abc123 2

# Bundles. A single bad condition or name collision rejects the whole install.
ironflow policy template list --json
ironflow policy template install tpl_admin_basics
```

### Platform operator surface

`ironflow platform ...` administers a self-hosted multi-tenant server. It needs an
`ifplatform_` key, or a JWT from `platform login` — which writes
`~/.config/ironflow/credentials.json`. Everything else here fails without one of those.

```bash
# Bootstrap: create-admin authenticates with IRONFLOW_API_KEY because it runs
# BEFORE login is possible. It refuses if any platform user already exists.
ironflow platform create-admin --email admin@example.com --name "Admin"
ironflow platform login --email admin@example.com

ironflow platform users list --json
ironflow platform users create --email user@example.com --name "User" --role-ids role_abc
ironflow platform users delete user_abc123

ironflow platform roles list --json
ironflow platform roles create my-role --policy-ids pol_abc
ironflow platform roles delete role_abc123

ironflow platform tenants list --json
ironflow platform tenants provision --name my-tenant
ironflow platform tenants delete tenant_abc123

ironflow platform audit --event-type user.created --limit 50
ironflow platform audit --from 2026-01-01 --to 2026-12-31 --json
```

`ironflow cloud ...` is Ironflow Cloud's own meta-cluster operator surface, not for
self-hosters.

---

## Full Reference

- CLI reference: https://docs.ironflow.run/reference/cli/
- CLI vs MCP: https://docs.ironflow.run/how-to-guides/ai-cli-vs-mcp/
