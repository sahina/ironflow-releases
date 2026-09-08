# Ironflow Migration

Guide SDK upgrades and event schema versioning with upcasters.

## Step 1: Determine Current Versions

```bash
# Server
ironflow version

# TypeScript SDK packages
grep -A1 '"@ironflow/node"' package.json
grep -A1 '"@ironflow/browser"' package.json
grep -A1 '"@ironflow/core"' package.json

# Go SDK
grep "ironflow" go.mod
```

## Step 2: Find Latest

**Everything ships in lockstep.** One release stamps the same version into the server,
all four npm packages, and the Go SDK — `scripts/release.sh` writes a single `$VERSION`
everywhere. So there is no "which version pairs with which"; they match by construction.

Public artifacts (the engine repo `sahina/ironflow` is **private** — end users cannot
read it):

| Artifact | Where | Tag/version format |
|---|---|---|
| Server binary, release notes | `sahina/ironflow-releases` | `v0.24.0` |
| Go SDK | `sahina/ironflow-go` (mirror) | `v0.24.0` — **not** `sdk/go/ironflow/v*` |
| JS SDK | npm `@ironflow/{core,node,browser,langgraph}` | `0.24.0` |

```bash
# Latest server + release notes (note --repo: the default repo is private)
gh release list --repo sahina/ironflow-releases --limit 5
gh release view v0.24.0 --repo sahina/ironflow-releases --json body -q .body

# Latest JS SDK (all four move together)
npm view @ironflow/node version

# Latest Go SDK
go list -m -versions github.com/sahina/ironflow-go
```

`sdk/go/ironflow/v*` tags exist only inside the private engine repo. Users consuming the
public mirror see plain `v<version>`.

If user just says "upgrade ironflow" without specifying, ask:
> "What are you upgrading? Server binary, Go SDK, or JS SDK packages?"

## Step 3: Compatibility

There is **no enforced SDK↔server version rule.** The server records the SDK version a
worker reports at registration but never compares it to its own — no reject, no warning.
Don't tell users an upgrade is blocked on ordering that isn't checked.

What is true: releases are lockstep, so the intended state is SDK version == server
version. Upgrade the server first anyway — it is backward-compatible with older SDKs,
and that ordering keeps the window one-directional.

## Step 4: Find Breaking Changes

```bash
# Single version
gh release view v0.24.0 --repo sahina/ironflow-releases --json body -q .body

# Range
for tag in v0.23.0 v0.24.0; do
  echo "=== $tag ==="
  gh release view "$tag" --repo sahina/ironflow-releases --json body -q .body
done
```

If `gh` is unavailable, browse <https://github.com/sahina/ironflow-releases/releases>.
`git log` against the engine repo is not an option for users — that repo is private.

Look for:
- **BREAKING** — requires code changes
- **Deprecated** — works but should update
- **New** — features available after upgrade

## Step 5: Update Dependencies

TypeScript — move all installed `@ironflow/*` packages together; they are lockstep:
```bash
pnpm update @ironflow/core @ironflow/node @ironflow/browser
# Or pin (use the SAME version for every package)
pnpm add @ironflow/node@0.24.0 @ironflow/browser@0.24.0
```

Go:
```bash
go get github.com/sahina/ironflow-go/ironflow@latest
# Or pin
go get github.com/sahina/ironflow-go/ironflow@v0.24.0
```

## Step 6: Apply Migration Patterns

After updating, fix compilation errors and deprecation warnings.

### Common Patterns

**Import path change:**
```typescript
// Old
import { createFunction } from "@ironflow/sdk";
// New
import { createFunction } from "@ironflow/node";
```

Search:
```bash
grep -rn "from ['\"]@ironflow/sdk['\"]" src/ --include="*.ts"
```

**API signature change** (e.g., `url` → `serverUrl`):
```typescript
// Old
createWorker({ url: "http://localhost:9123", functions: [...] });
// New
createWorker({ serverUrl: "http://localhost:9123", functions: [...] });
```

**Projection handler signature** (handlers usually backward-compatible — extra args optional):
```typescript
// Old: (state, event) => state
// New: (state, event, context) => state
```

## Step 7: Test

```bash
pnpm test           # TS
go test ./...        # Go
```

If tests fail → switch to `debug.md` workflow.

## Step 8: Verify Rollback Works

Before deploying to prod:
1. Test upgrade in staging
2. Verify all tests pass
3. Test rollback:
   ```bash
   pnpm add @ironflow/node@<old-version>
   ```
   Restart, verify works with old version.
4. If projections changed: test `ironflow projection rebuild <name>` with both versions.

---

## Event Schema Versioning (Upcasters)
<!-- derived-from: docs/how-to-guides/event-sourcing/versioning.mdx#registering-events -->

Upcasters transform events from old schema to new at READ TIME. They do NOT modify stored
events. All upcasting is **SDK-side** — the server never upcasts anything.

### TypeScript

Upcasters reach the runtime through `eventDefinitions`, not through a bare registry.
One `defineEvent` per version; the registry wires each version's `upcast` as
`version-1 → version` automatically (and ignores `upcast` on version 1).

```typescript
import { defineEvent, createEventDefinitionRegistry } from "@ironflow/core";
import { createWorker } from "@ironflow/node";

const events = createEventDefinitionRegistry();

events.register(defineEvent({ name: "user.created", version: 1 }));

// v1 → v2: combine fields. `data` is `unknown` — cast before touching it.
events.register(defineEvent({
  name: "user.created",
  version: 2,
  upcast: (data) => {
    const { firstName, lastName, ...rest } = data as Record<string, unknown>;
    return { ...rest, fullName: `${firstName} ${lastName}` };
  },
}));

// v2 → v3: add default
events.register(defineEvent({
  name: "user.created",
  version: 3,
  upcast: (data) => {
    const d = data as Record<string, unknown>;
    return { ...d, role: d.role ?? "member" };
  },
}));

const worker = createWorker({ functions: [...], eventDefinitions: events });
```

`serve({ functions, eventDefinitions })` takes the same option for push mode.

There is also a lower-level `createUpcasterRegistry()` in `@ironflow/core`, but nothing
accepts it as config — it only supports manual `.upcast(...)` calls. Don't hand a user a
bare registry and imply it will be applied. (`UpcasterRegistry` is not exported at all;
`import { UpcasterRegistry }` fails.)

### Go

The config field is `Upcasters` (different name from JS), and the function signature is
`json.RawMessage` in and out, **with an error return**:

```go
registry := ironflow.NewUpcasterRegistry()

registry.Register("user.created", 1, 2, func(data json.RawMessage) (json.RawMessage, error) {
    var m map[string]any
    if err := json.Unmarshal(data, &m); err != nil {
        return nil, err
    }
    firstName, _ := m["firstName"].(string)
    lastName, _ := m["lastName"].(string)
    delete(m, "firstName")
    delete(m, "lastName")
    m["fullName"] = firstName + " " + lastName
    return json.Marshal(m)
})

// NewWorker returns *Worker only — there is no error to assign.
worker := ironflow.NewWorker(ironflow.WorkerConfig{
    Functions: []ironflow.Function{...},   // values, not pointers
    Upcasters: registry,
})
```

### Chaining (v1 → v3 automatic)

If event is stored as v1 and current schema is v3, registry applies v1→v2 then v2→v3 in
sequence. No need to write v1→v3 directly.

### Rules

1. **Always spread `...rest`** — preserve fields you don't transform. Forgetting this
   DELETES data.
2. **Chain sequentially** — v1→v2, v2→v3, v3→v4. Never skip. This is load-bearing in Go,
   where `Upcast` walks `currentVersion++` and ignores the `toVersion` you registered; a
   gap stalls the chain. JS follows `toVersion`, so it tolerates gaps — don't rely on it.
3. **Read-time only** — stored events unchanged, and the server does no upcasting at all.
4. **Forward only** — no downcasters.
5. **Functions only — projections do NOT upcast.** `eventDefinitions` is never plumbed
   into the projection runner; handlers receive raw stored data at whatever version it
   was written. A projection reading a v1 event sees v1 fields. Version-handle inside the
   reducer, or rebuild after a schema change.

---

## Pre-Migration Checklist

1. **Back up data.** SQLite: copy file. PostgreSQL: snapshot.
2. **Fetch release notes.** `gh release view <tag>` for each version between current and
   target. Note all breaking changes.
3. **Plan to land server and SDK on the same version** (releases are lockstep). Nothing
   enforces this — the server never checks the SDK version a worker reports.
4. **Update dependencies** with package manager.
5. **Fix compilation errors.**
6. **Write upcasters** for any event schema changes.
7. **Run all tests.**
8. **Test in staging first.**
9. **Deploy order:** server first, then app code (server is backward-compatible).

---

## Rollback Plan

1. **Keep old binary** before upgrading server.
2. **Upcasters are forward-only.** Events written with new schema can't downcast.
3. **Revert SDK + code + restart:**
   - Revert dependency to previous version
   - Revert code changes (imports, API signatures)
   - Restart worker/app
4. **Server downgrade:** restore previous binary, restart. Migrations are forward-compatible
   (additive, no DROPs), so old code generally reads new schema.
5. **Projection rebuild after rollback** if handlers changed:
   `ironflow projection rebuild <name>`

---

**Next:** After successful migration:
- `/ironflow-code` (audit mode) — verify upgraded code follows current best practices
- `/ironflow-code` (test mode) — generate or update tests for new APIs
