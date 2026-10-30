# Ironflow Docker Compose

Deploy artifacts for Ironflow v0.54.0. Each compose file runs the
`ghcr.io/sahina/ironflow-releases:0.54.0` image unless you set `IRONFLOW_IMAGE`.
Needs Docker Compose v2.23.1 or later.

## Sizes

| Size | File | Runs |
|------|------|------|
| Single node | `docker-compose.single-node.yml` | 1 Ironflow, embedded NATS, SQLite (or Postgres with `--profile postgres`) |
| Starter | `cluster/docker-compose.starter.yml` | 1 Ironflow, 1 NATS, Postgres, SeaweedFS |
| Cluster | `cluster/docker-compose.cluster.yml` | 3 Ironflow behind nginx (`:9000`), 3 NATS, Postgres, SeaweedFS |
| HA | `cluster/docker-compose.ha.yml` | 3 Ironflow behind nginx (`:9000`), 5 NATS, 3 Postgres with automatic failover (Patroni + etcd), SeaweedFS |

`cluster/docker-compose.multi-node.yml` builds from source and needs the engine repo.

## Start a cluster size

```bash
git clone --branch v0.54.0 https://github.com/sahina/ironflow-releases.git
cd ironflow-releases/deploy/docker-compose/cluster
./init-env.sh                                     # writes .env with generated keys; keep a copy
docker compose -f docker-compose.starter.yml up -d  # or cluster / ha
```

Run one size per host at a time: the sizes use the same host ports.

Full guide: https://docs.ironflow.run/how-to-guides/deployment/docker-compose/
