# YAML Configuration Examples

Four example configurations showing progressive infrastructure complexity.

## Quick Test

```bash
# Build first
make build

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
```
