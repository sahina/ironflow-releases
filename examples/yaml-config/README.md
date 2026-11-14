# YAML Configuration Examples

Four example configurations showing progressive infrastructure complexity.

## Quick Test

```bash
# Build first. `embed` matters: from a fresh clone a plain `make build` produces a
# binary whose `serve` exits "embedded dashboard missing (static/index.html not found)".
make embed build

# 1. Validate without booting
./build/ironflow validate -f examples/yaml-config/ironflow.yaml

# 2. Boot local dev server from YAML
./build/ironflow serve -f examples/yaml-config/ironflow.yaml

# 3. Override a YAML value with a CLI flag
./build/ironflow serve -f examples/yaml-config/ironflow.yaml --port 8080

# 4. Generate a fresh template
./build/ironflow config init > /tmp/test.yaml
./build/ironflow validate -f /tmp/test.yaml
```

## Files

| File                     | Kind     | Description                                  |
| ------------------------ | -------- | -------------------------------------------- |
| `ironflow.yaml`          | Server   | Local dev — minimal, SQLite, dev mode        |
| `ironflow-prod.yaml`     | Server   | Production single-node — PostgreSQL, metrics |
| `ironflow-cluster.yaml`  | Cluster  | Multi-node — external NATS, stable node IDs  |
| `ironflow-platform.yaml` | Platform | Multi-tenant — orgs, projects, environments  |

## Validate All

```bash
# Dev config (no env vars needed)
./build/ironflow validate -f examples/yaml-config/ironflow.yaml

# All PostgreSQL examples below also need these variables:
export IRONFLOW_JWT_SECRET="$(openssl rand -hex 32)"
export IRONFLOW_BOOTSTRAP_KEY_FILE="/tmp/ironflow-bootstrap.json"
export IRONFLOW_BLOB_URL="s3://bucket?endpoint=https://s3.example.com"

# Prod config (needs env vars)
IRONFLOW_DATABASE_URL="postgres://localhost/test" \
IRONFLOW_MASTER_KEY="abc123" \
./build/ironflow validate -f examples/yaml-config/ironflow-prod.yaml

# Cluster (needs env vars)
IRONFLOW_DATABASE_URL="postgres://localhost/test" \
NATS_URL="nats://localhost:4222" \
IRONFLOW_NODE_ID="node-1" \
IRONFLOW_MASTER_KEY="abc123" \
./build/ironflow validate -f examples/yaml-config/ironflow-cluster.yaml

# Platform (needs env vars)
IRONFLOW_DATABASE_URL="postgres://localhost/test" \
NATS_URL="nats://localhost:4222" \
IRONFLOW_NODE_ID="node-1" \
IRONFLOW_MASTER_KEY="abc123" \
./build/ironflow validate -f examples/yaml-config/ironflow-platform.yaml
```

`validate` checks syntax, schema, `${VAR}` references and kind-specific rules (for example, `Cluster` needs PostgreSQL, external NATS and a `nodeId`). It also checks the PostgreSQL blob URL, JWT secret format, and explicit bootstrap output. The values above are placeholders: `abc123` is not a usable master key.

## Booting the cluster and platform configs

PostgreSQL YAML examples require `IRONFLOW_JWT_SECRET` (hex), `IRONFLOW_BOOTSTRAP_KEY_FILE` (private output path), and `IRONFLOW_BLOB_URL` (`s3://bucket?endpoint=https://host`). Both `validate` and `serve` check these settings. To start the server, supply:

- PostgreSQL and an external NATS server with JetStream and a store directory (`nats-server -js -sd ./nats-data`). The streams are on disk. Without `-sd`, NATS keeps them in the system temporary directory, which a reboot can delete and other processes on the machine share.
- A 64-character hex master key, for example `openssl rand -hex 32`.
- An `s3://` blob store, set with `IRONFLOW_BLOB_URL="s3://bucket?endpoint=https://s3.example.com&region=us-east-1"` or `spec.blobs.url`. Both `serve` and `validate` refuse a missing blob URL.
