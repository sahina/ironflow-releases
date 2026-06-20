// Walkthrough Step 3 — command handler.
// Orchestrates: claim → enrich → load → decide → append → finalize.
//
// Uses the **claim-first** idempotency pattern: reserve the commandId via a
// KV `create` (if-not-exists) BEFORE doing any work. If the claim fails,
// another writer has already processed this command — return their result.
// On append failure we release the claim so retries can proceed.

import { ironflow } from "./ironflow-server";
import { commandDedup, type DedupEntry } from "./command-dedup";
import { customerRepo, productCatalog } from "./enrichment";
import { foldOrder, placeOrder } from "./aggregate";
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

  // 1. Atomic claim — first writer wins. Concurrent retries with the same
  //    commandId converge here: one proceeds, the others return the winner's
  //    result without re-running the handler.
  const claim: DedupEntry = {
    orderId: data.orderId,
    claimedAt: new Date().toISOString(),
  };
  const prior = await commandDedup.tryClaim(metadata.commandId, claim);
  if (prior !== null) {
    return {
      orderId: prior.orderId,
      entityVersion: prior.entityVersion ?? 0,
      dedup: true,
    };
  }

  try {
    // 2. Enrichment — freeze "current" values into the event.
    const customer = await customerRepo.getById(data.customerId);
    const products = await productCatalog.getMany(
      data.items.map((i) => i.productId),
    );

    // 3. Load current stream state.
    const { events } = await ironflow.streams.read(data.orderId);
    const state = foldOrder(events);

    // 4. Decide — validate and produce domain events.
    const newEvents = placeOrder(
      state,
      data,
      customer,
      products,
      metadata.issuedAt,
    );

    // 5. Append atomically with optimistic concurrency. Cross-cutting IDs
    //    ride in the `metadata` option — not inside `data`. Downstream
    //    handlers and projections read them via `event.metadata`.
    const eventMetadata: EventMeta = {
      causationId: metadata.commandId,
      correlationId: metadata.correlationId ?? metadata.commandId,
      tenantId: metadata.tenantId,
      traceId: metadata.traceId,
      issuedBy: metadata.issuedBy,
    };

    let expectedVersion = state.version;
    let lastEntityVersion = expectedVersion;
    for (const ev of newEvents) {
      const res = await ironflow.streams.append(
        data.orderId,
        {
          entityType: "order",
          name: ev.name,
          data: ev.data,
        },
        { expectedVersion, metadata: eventMetadata },
      );
      expectedVersion = res.entityVersion;
      lastEntityVersion = res.entityVersion;
    }

    // 6. Finalize the claim with the resulting version. Subsequent retries
    //    with the same commandId will now return this version directly.
    await commandDedup.finalize(metadata.commandId, {
      ...claim,
      completedAt: new Date().toISOString(),
      entityVersion: lastEntityVersion,
    });

    return {
      orderId: data.orderId,
      entityVersion: lastEntityVersion,
      dedup: false,
    };
  } catch (err) {
    // Release the claim so an honest retry can proceed. We swallow the
    // release error (best-effort) so the original error propagates.
    await commandDedup.release(metadata.commandId).catch(() => {});
    throw err;
  }
}
