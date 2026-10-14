// Walkthrough Step 3 — command handler.
// A pending reservation is recoverable; the committed event proves completion.

import { NonRetryableError, type StreamEvent } from "@ironflow/node";
import { ironflow } from "./ironflow-server";
import { commandDedup, type DedupEntry } from "./command-dedup";
import { customerRepo, productCatalog } from "./enrichment";
import { foldOrder, placeOrder } from "./aggregate";
import { STREAM_EVENTS } from "./events";
import type { PlaceOrderCommand, EventMeta } from "./types";

export type PlaceOrderResult = {
  orderId: string;
  entityVersion: number;
  dedup: boolean;
};

export async function placeOrderHandler(
  cmd: PlaceOrderCommand,
): Promise<PlaceOrderResult> {
  const { data, metadata } = cmd;

  const claim: DedupEntry = {
    orderId: data.orderId,
    claimedAt: new Date().toISOString(),
  };
  const prior = await commandDedup.tryClaim(metadata.commandId, claim);
  if (prior !== null) {
    if (prior.orderId !== data.orderId) {
      throw new NonRetryableError("Command ID already used for another order");
    }
    // Empty defaults ("" / 0) in a serialized pending record do not prove completion.
    const { completedAt, entityVersion } = prior;
    if (
      typeof completedAt === "string" && completedAt !== "" &&
      typeof entityVersion === "number" && Number.isSafeInteger(entityVersion) && entityVersion > 0
    ) {
      return { orderId: prior.orderId, entityVersion, dedup: true };
    }
  }

  const finish = async (entityVersion: number, dedup: boolean): Promise<PlaceOrderResult> => {
    await commandDedup.finalize(metadata.commandId, {
      ...claim,
      claimedAt: prior?.claimedAt ?? claim.claimedAt,
      completedAt: new Date().toISOString(),
      entityVersion,
    });
    return { orderId: data.orderId, entityVersion, dedup };
  };
  const isReceipt = (ev: StreamEvent) =>
    ev.name === STREAM_EVENTS.OrderPlaced && ev.metadata?.causationId === metadata.commandId;
  const { events } = await ironflow.streams.read(data.orderId);
  const receipt = events.find(isReceipt);
  if (receipt) return finish(receipt.entityVersion, true);

  const customer = await customerRepo.getById(data.customerId);
  const products = await productCatalog.getMany(data.items.map((i) => i.productId));
  const state = foldOrder(events);
  const [ev] = placeOrder(state, data, customer, products, metadata.issuedAt);
  const eventMetadata: EventMeta = {
    causationId: metadata.commandId,
    correlationId: metadata.correlationId ?? metadata.commandId,
    tenantId: metadata.tenantId,
    traceId: metadata.traceId,
    issuedBy: metadata.issuedBy,
  };

  let ack: { eventId: string };
  try {
    ack = await ironflow.streams.append(
      data.orderId,
      { entityType: "order", name: ev.name, data: ev.data },
      {
        expectedVersion: state.version,
        // Engine idempotency keys are environment-wide; scope to the order so a reused
        // command ID cannot return another order's event. IDs may contain ':', so encode
        // both parts to keep the delimiter unambiguous.
        idempotencyKey: `cqrs-order:place-order:${encodeURIComponent(data.orderId)}:${encodeURIComponent(metadata.commandId)}`,
        metadata: eventMetadata,
      },
    );
  } catch (err) {
    const { events: committed } = await ironflow.streams.read(data.orderId);
    const receipt = committed.find(isReceipt);
    if (receipt) return finish(receipt.entityVersion, true);
    throw err;
  }
  // An acknowledgement is not proof: the engine's environment-wide key index can answer
  // with a non-entity event or another stream's event. Only this command's receipt is.
  const { events: committed } = await ironflow.streams.read(data.orderId);
  const placed = committed.find(isReceipt);
  if (!placed) {
    throw new NonRetryableError("Append acknowledged without a committed entity version for this command");
  }
  // Finalization failures leave the receipt recoverable on the next retry.
  return finish(placed.entityVersion, placed.id !== ack.eventId);
}
