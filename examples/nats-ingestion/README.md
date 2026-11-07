# Publish an external trigger with acknowledgement

Use a JetStream client against your configured broker. With nats.go v1.55.0,
wait for `Publish` to return its PubAck before reporting broker acceptance.

```go
ack, err := js.Publish(ctx,
    "ironflow.default.env_default.events.ingest.order.created",
    payload, // The ingest envelope includes a stable event ID.
    jetstream.WithMsgID(eventID))
if err != nil {
    // Capacity rejection is failure. Timeout means acceptance is unknown.
    return fmt.Errorf("trigger publish not confirmed: %w", err)
}
log.Printf("broker accepted stream=%s sequence=%d duplicate=%t", ack.Stream, ack.Sequence, ack.Duplicate)
```

Async publishing must await the future's ACK or error channel. Core publish
and flush are insufficient. Retrying the same identity helps inside the broker's
two-minute dedupe window; it does not provide permanent execution deduplication.

Read the [retention limits and stopped-writer upgrade contract](../../docs/reference/nats-ingestion.md).
Consumers' ACKs do not free LimitsPolicy capacity. Terminal message reclamation
restores publishing capacity. Keep old binaries and credentials fenced.
