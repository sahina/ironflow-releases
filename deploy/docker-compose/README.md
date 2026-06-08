# Ironflow Docker Compose

Deploy artifacts, published from the Ironflow engine on each release.

## Single node

```bash
cd deploy/docker-compose
docker compose -f docker-compose.single-node.yml up                                    # SQLite + embedded NATS
docker compose -f docker-compose.single-node.yml --profile postgres --profile monitoring up
```

## Multi-node cluster

```bash
cd deploy/docker-compose/cluster
cp .env.example .env
export IRONFLOW_IMAGE=ghcr.io/sahina/ironflow-releases:latest
docker compose -f docker-compose.cluster.yml up                       # 3-node NATS quorum
docker compose -f docker-compose.cluster.yml --profile monitoring up  # + Prometheus / Jaeger / Grafana
```

`docker-compose.multi-node.yml` is the local-build dev variant (single NATS, carries a
`build:` context) and needs the engine repo. From this published tree, use
`docker-compose.cluster.yml` with the public image set via `IRONFLOW_IMAGE`.

Full guide: https://docs.ironflow.run/how-to-guides/deployment/docker-compose/
