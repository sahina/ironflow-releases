#!/usr/bin/env node
// The crash proof.
//
// It is the one test that answers "what does durable actually buy me?" with
// evidence instead of a claim. It runs the whole system through the launcher a
// presenter runs, walks a `pm_crash` order to the point where the card is held
// and the run is parked, kills the payment worker through the real control
// plane, lets the supervisor bring it back, releases the wait, and then reads
// the gateway's own SQLite ledger.
//
// The assertion is the point: the authorization is one row with one call, after
// a process died and a different process finished its work.
//
// Why the wait is where it is. A run parked on `step.waitForEvent` holds no
// worker claim, so killing the worker there costs nothing and needs no
// stale-claim timeout to recover — which is exactly what makes the scenario
// presentable in front of an audience.
import { strict as assert } from "node:assert";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { DATA_DIR, sendControl } from "./lib/control.mjs";
import { checker, commandMetadata, engineApi, newId, redact, startSupervisor } from "./lib/live.mjs";
import { freshWorkerIds, PAYMENT_FUNCTION_ID } from "./lib/workers.mjs";
import { waitFor } from "./lib/readiness.mjs";

const CRASH_DATA = join(DATA_DIR, "crash-test");
const SUPERVISOR_FILE = join(CRASH_DATA, "supervisor.json");
const GATEWAY_DB = join(CRASH_DATA, "payments-gateway.db");


const check = checker();

/**
 * The gateway's side-effect ledger, read the way a human would: open the file
 * the worker wrote and count.
 *
 * Read-only, and the worker keeps writing to it — SQLite in WAL mode is fine
 * with a second reader.
 */
function gatewayCalls(orderId) {
  const db = new DatabaseSync(GATEWAY_DB, { readOnly: true });
  try {
    return db
      .prepare("SELECT operation, call_count, dedup_hits FROM gateway_calls WHERE order_id = ? ORDER BY operation")
      .all(orderId)
      .map((row) => ({
        operation: row.operation,
        callCount: Number(row.call_count),
        dedupHits: Number(row.dedup_hits),
      }));
  } finally {
    db.close();
  }
}


async function main() {
  rmSync(CRASH_DATA, { recursive: true, force: true });

  let supervisor;
  try {
    supervisor = await startSupervisor({ dataDir: CRASH_DATA });
    const api = engineApi(supervisor);
    const session = newId();
    const orderId = newId();
    const meta = commandMetadata(orderId, session);

    const orderReaching = (status, options) =>
      waitFor(`order ${orderId} to reach ${status}`, async () => {
        const projected = await api.projectedOrder(orderId);
        return projected?.status === status ? projected : undefined;
      }, options);
    const paymentFacts = async () => (await api.paymentStream(orderId)).map((event) => event.name);

    // Everything below goes through the public surface the browser uses. There
    // is no shortcut into a service's own state, because a proof that needed one
    // would not be a proof about the system a presenter shows.
    await check("a crash-scenario order is placed and approved", async () => {
      await api.emit("place.order", {
        orderId,
        customerEmail: "ada@example.com",
        items: [{ sku: "sku_desk_lamp", quantity: 1 }, { sku: "sku_notebook", quantity: 2 }],
        totalCents: 6900,
        currency: "USD",
        paymentMethodToken: "pm_crash",
      }, meta);

      // Wait for the read model before approving. The durable wait is created
      // when the run parks on it and matched only on arrival, so an approval
      // that beats the run there is dropped and the order sits in
      // pending_approval until its seven-day timeout, with no error anywhere.
      await orderReaching("pending_approval");
      await api.emit("approve.order", { orderId, approvedBy: "ops@example.com" }, meta);
      await orderReaching("processing_payment");
    });

    let crashedWorker;
    await check("the card is held and the run parks before capture", async () => {
      await waitFor("payment.authorized", async () => (await paymentFacts()).includes("payment.authorized"));
      assert.deepEqual(await paymentFacts(), ["payment.authorized"]);
      assert.deepEqual(gatewayCalls(orderId), [{ operation: "authorize", callCount: 1, dedupHits: 0 }]);

      // Wait for the *park*, not for the fact.
      //
      // The append happens inside the authorize step body; the run parks a
      // moment later, when the wait yields. Crashing in that window leaves the
      // run claimed by a dead worker, and the demo.payment.continue emitted
      // below arrives with nothing waiting for it and is dropped — the trap
      // recorded in services/orders-go/CONTEXT.md. The run would then sit until
      // stale-claim reclaim, replay authorize, and park after its release event
      // was already gone.
      //
      // A yielded wait step is the engine's own evidence that the park
      // happened, because the yield update is what creates it.
      await waitFor("the payment run to park on the presenter's wait", async () => {
        for (const run of await api.runs({ function_id: PAYMENT_FUNCTION_ID })) {
          const steps = await api.runSteps(run.id);
          if (steps.some((step) => step.wait_event_name === "demo.payment.continue" && step.status === "waiting")) {
            return run.id;
          }
        }
        return undefined;
      }, { timeoutMs: 60_000 });

      [crashedWorker] = freshWorkerIds(await api.workers());
      assert.ok(crashedWorker, "no live payment worker to crash");
    });

    await check("the presenter's crash control kills the payment worker and it comes back", async () => {
      // The real control plane, over the real authenticated loopback socket —
      // the same call `make reference-app-crash-payment` makes.
      const message = await sendControl("crash", "payments", { file: SUPERVISOR_FILE });
      assert.match(message, /payments crashed \(SIGKILL\) and restarted/);

      // A different worker id, not merely a non-empty list: the engine never
      // removes the killed worker's record, so "some worker is listed" would be
      // true even if nothing had restarted.
      const replacement = await waitFor("a replacement payment worker to register", async () => {
        const live = freshWorkerIds(await api.workers()).filter((id) => id !== crashedWorker);
        return live[0];
      }, { timeoutMs: 60_000 });
      assert.notEqual(replacement, crashedWorker);
    });

    await check("the replacement finishes the interrupted payment", async () => {
      await api.emit("demo.payment.continue", { orderId }, meta);

      const paid = await orderReaching("paid", { timeoutMs: 60_000 });
      assert.ok(paid.captureId, "the order reached paid with no capture");
      assert.deepEqual(await paymentFacts(), ["payment.authorized", "payment.captured"]);
    });

    // The whole point. The gateway is the only external system in this example,
    // and its ledger says the card was held once and charged once — across a
    // SIGKILL, a restart, and a completion by a process that never made the
    // first call.
    //
    // `dedupHits: 0` on the authorization is the sharper half. Zero means the
    // replacement worker never presented the authorization key at all: the step
    // was memoized and skipped, not re-run and caught by the idempotency key. It
    // is what separates "durable replay works" from "the gateway is defensive".
    await check("the gateway was asked for exactly one authorization and one capture", () => {
      assert.deepEqual(gatewayCalls(orderId), [
        { operation: "authorize", callCount: 1, dedupHits: 0 },
        { operation: "capture", callCount: 1, dedupHits: 0 },
      ]);
    });

    await check("shutdown leaves nothing behind", async () => {
      assert.equal(await supervisor.stop(), 0);
    });

    process.stdout.write("reference-app crash proof passed\n");
    // Clean only on success: a failed run keeps its engine database, its gateway
    // ledger and its logs, which are the three things worth reading.
    rmSync(CRASH_DATA, { recursive: true, force: true });
  } catch (error) {
    if (supervisor) await supervisor.stop();
    process.stderr.write(
      `\nreference-app crash proof FAILED: ${error.message}\n\n--- supervisor log ---\n${redact(supervisor?.text() ?? "")}\n`,
    );
    process.stderr.write(`state kept at ${CRASH_DATA}\n`);
    process.exitCode = 1;
  }
}

await main();
