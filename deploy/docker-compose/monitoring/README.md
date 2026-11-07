# Prometheus alert rules

The plain rule files preserve the 37 alerts formerly shipped by the Helm chart and add `JetStreamStreamFault`.
`prometheus.yml` is a standalone host-network configuration for the planned appliance.
It loads every rule. It does not install exporters or create an appliance runtime.
Run Prometheus with this directory as its configuration directory, so the relative
`rules/*.yml` paths resolve beside `prometheus.yml`.

The single-node Compose `monitoring` profile loads the 20 engine rules.
Cluster, multi-node, and HA monitoring also load the four NATS rules and enable
`-jsz=all` on the NATS exporter. These profiles do not ship a host exporter,
PostgreSQL exporter, Blackbox Exporter, or Alertmanager. They therefore omit
the 14 appliance infrastructure and PostgreSQL rules. Alert evaluation is local;
Compose does not configure a notification receiver.

## Appliance exporter contract

All addresses in the standalone configuration are loopback addresses. Run the
services on the same host network. For several appliances, run one Prometheus per
appliance or add an appliance label and retain it in aggregations before combining
series. These rules aggregate within one appliance, including its engine nodes.

| Job | Endpoint | Required configuration |
| --- | --- | --- |
| `ironflow` | `127.0.0.1:9123/metrics` | Enable engine metrics. Add every engine node to this job. Do not mix control-plane HTTP metrics into it. |
| `nats` | `127.0.0.1:7777/metrics` | `natsio/prometheus-nats-exporter:0.20.3` with `-varz -jsz=all -port=7777 http://127.0.0.1:8222`. Do not set `-prefix`. |
| `postgres` | `127.0.0.1:9187/metrics` | `prometheuscommunity/postgres-exporter:v0.18.1` with `--extend.query-path=postgres-queries.yml`. Grant its database role `pg_monitor` and access to the application database. |
| `node` | `127.0.0.1:9100/metrics` | Linux node_exporter with filesystem, meminfo, and textfile collectors. The data filesystem must be mounted at `/var/lib/ironflow`; update the filesystem rule selectors if the appliance uses another mountpoint. |
| `blackbox` | `127.0.0.1:9115/probe` | Blackbox Exporter with the standard `tcp_connect` and `http_2xx` modules. The target label distinguishes NATS, PostgreSQL, and engine health. |
| `alertmanager` | `127.0.0.1:9093/metrics` | Configure the notification receiver separately before relying on paging. |

The NATS metrics use exporter 0.20.3's `jetstream_*` and `gnatsd_varz_*` names.
Account usage is summed per server before division by the server maximum.
A maximum of zero means unlimited and is excluded. Consumer labels are
`stream_name` and `consumer_name`.
The memory alert measures JetStream memory usage against its configured maximum,
not total process RSS against a container memory limit.

`postgres-queries.yml` defines the connection, WAL replay distance, transaction,
and rollback metrics used by the PostgreSQL rules. The replication query is for
primaries; a primary without replicas reports zero. It does not replace a check
that expected replicas exist. PostgreSQL disk rules measure the appliance data
filesystem rather than Kubernetes PVCs. The database and its WAL must reside there.

The complete-backup runner must atomically write a node_exporter textfile after
successful archive validation, in the directory passed to
`--collector.textfile.directory`. Write a Unix timestamp in seconds:

```text
# TYPE appliance_backup_last_success_timestamp_seconds gauge
appliance_backup_last_success_timestamp_seconds 1793577600
```

Keep the prior value on backup failure. Do not update it at backup start. The
backup alert fires when this series is absent or older than 48 hours, with a
one-hour grace period. This is an integration contract; the current backup runner
does not publish this textfile. Connect the runner before relying on backup alerts.

## Check the rules

From the repository root, using fish:

```fish
docker run --rm --entrypoint /bin/promtool -w /monitoring \
  -v "$PWD/deploy/docker-compose/monitoring:/monitoring:ro" \
  prom/prometheus:v3.15.1 check rules rules/ironflow.yml rules/infrastructure.yml rules/nats.yml rules/postgresql.yml
docker run --rm --entrypoint /bin/promtool -w /monitoring \
  -v "$PWD/deploy/docker-compose/monitoring:/monitoring:ro" \
  prom/prometheus:v3.15.1 test rules rules.test.yml
```

The Go `TestShippedPromQLContract` checks every engine metric and label against
the actual metrics registry. `TestPolicySet_U09_AlertRuleShipped` keeps the
organization-scoped compile-failure alert present.
