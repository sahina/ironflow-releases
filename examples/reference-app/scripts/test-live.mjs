#!/usr/bin/env node
// The live gate: the supervisor humans use, driving the real engine binary.
//
// It runs against a fresh data directory under .data/, so it never disturbs a
// demo's history, and `make reference-app-reset` still cleans up after it.
//
// It proves the boot contract — the real binary starts on a discovered port,
// serves the embedded dashboard, publishes an authenticated control handshake
// and leaves nothing behind on shutdown — and the two uninterrupted domain
// paths on top of it: an order priced against the catalog, approved, authorized
// and captured, and an order the gateway permanently declines. The third path,
// the presenter's crash, is scripts/test-crash-resume.mjs. The Chromium
// walkthrough joins them in #1894 task 12.
import { strict as assert } from "node:assert";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { DatabaseSync } from "node:sqlite";

import { DATA_DIR, sendControl } from "./lib/control.mjs";
import { checker, commandMetadata, engineApi, newId, redact, startSupervisor, staysTrue } from "./lib/live.mjs";
import { PAYMENT_FUNCTION_ID } from "./lib/workers.mjs";
import { waitFor } from "./lib/readiness.mjs";

const LIVE_DATA = join(DATA_DIR, "live-test");
const SUPERVISOR_FILE = join(LIVE_DATA, "supervisor.json");

const check = checker();

/** The Python subscriber's own delivery log, read from its SQLite file. */
function deliveries(orderId) {
  const db = new DatabaseSync(join(LIVE_DATA, "notifications.db"), { readOnly: true });
  try {
    return db
      .prepare("SELECT message_id, status, emitted FROM deliveries WHERE order_id = ? ORDER BY sequence")
      .all(orderId);
  } finally {
    db.close();
  }
}

/** Repeat presentations of one gateway key, read from the worker's own ledger. */
function gatewayDedupHits(orderId, operation) {
  const db = new DatabaseSync(join(LIVE_DATA, "payments-gateway.db"), { readOnly: true });
  try {
    const row = db
      .prepare("SELECT COALESCE(SUM(dedup_hits), 0) AS hits FROM gateway_calls WHERE order_id = ? AND operation = ?")
      .get(orderId, operation);
    return Number(row.hits);
  } finally {
    db.close();
  }
}

async function main() {
  // A fresh directory: the boot path under test includes first-boot bootstrap.
  rmSync(LIVE_DATA, { recursive: true, force: true });

  let supervisor;
  try {
    supervisor = await startSupervisor({ dataDir: LIVE_DATA });
    const { url, webUrl, apiKey } = supervisor;
    const api = engineApi({ url, apiKey });

    await check("the engine reports ready on a discovered port", async () => {
      assert.ok(supervisor.port > 0);
      assert.equal((await fetch(`${url}/ready`)).status, 200);
    });

    await check("the embedded dashboard is served", async () => {
      const response = await fetch(url);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /<html/i);
    });

    const session = newId();
    const items = [
      { sku: "sku_desk_lamp", quantity: 1 },
      { sku: "sku_notebook", quantity: 2 },
    ];
    const place = (orderId, paymentMethodToken) =>
      api.emit(
        "place.order",
        {
          orderId,
          customerEmail: "ada@example.com",
          items,
          totalCents: 6900,
          currency: "USD",
          paymentMethodToken,
        },
        commandMetadata(orderId, session),
      );
    const orderReaching = (orderId, status) =>
      waitFor(`order ${orderId} to reach ${status}`, async () => {
        const projected = await api.projectedOrder(orderId);
        return projected?.status === status ? projected : undefined;
      });

    await check("every publisher registered the schemas it owns", async () => {
      const names = await api.schemaNames();
      for (const owned of [
        "order.placed", "order.approved", "order.released",
        "order.paid", "order.payment_failed", "notifications.order-status",
        "payment.authorized", "payment.captured", "payment.declined",
        "demo.payment.continue", "notification.sent",
      ]) {
        assert.ok(names.includes(owned), `${owned} is not registered`);
      }
      // Also proves this gate captures every child's log, which is what the
      // publish assertion below reads.
      assert.match(supervisor.text(), /\[orders]\s+ordering ready/);
      assert.match(supervisor.text(), /\[payments]\s+payments ready/);
      assert.match(supervisor.text(), /\[notifications]\s+notifications ready/);
    });

    const orderId = newId();

    await check("an order is priced from the catalog and waits for approval", async () => {
      await place(orderId, "pm_success");
      const order = await orderReaching(orderId, "pending_approval");
      assert.equal(order.totalCents, 6900);
      assert.equal(order.demoSessionId, session);
    });

    await check("a total the catalog disagrees with never reaches the stream", async () => {
      const rejected = newId();
      // Schema-valid on the wire; only the catalog can tell it is wrong.
      await api.emit("place.order", {
        orderId: rejected,
        customerEmail: "ada@example.com",
        items,
        totalCents: 1,
        currency: "USD",
        paymentMethodToken: "pm_success",
      }, commandMetadata(rejected, session));

      await staysTrue(
        "the mispriced order stayed out of the read model and the stream",
        async () => (await api.projectedOrder(rejected)) === undefined && (await api.orderStream(rejected)).length === 0,
      );
    });

    await check("approval releases the durable wait", async () => {
      await api.emit("approve.order", { orderId, approvedBy: "ops@example.com" }, commandMetadata(orderId, session));

      await waitFor("the approval wait to release the order", async () =>
        (await api.orderStream(orderId)).some((event) => event.name === "order.released"),
      );
      // A prefix, not the whole stream: the payment worker is running, so this
      // order continues on its own and `order.paid` may already have landed.
      const names = (await api.orderStream(orderId)).map((event) => event.name);
      assert.deepEqual(names.slice(0, 3), ["order.placed", "order.approved", "order.released"]);

      // Reaching release means the service published to the notifications topic.
      // A publish that failed is logged and dropped — deliberately, since
      // notification is not an order invariant — so the absence of that log line
      // is the only proof the topic really works. Task 8's subscriber needs it.
      assert.ok(
        !/publishing the .* notification failed/.test(supervisor.text()),
        "an order-status notification failed to publish",
      );
    });

    await check("the payment worker authorizes, captures, and only then is the order paid", async () => {
      const paid = await orderReaching(orderId, "paid");
      assert.ok(paid.captureId, "an order reached paid with no capture");

      const payment = (await api.paymentStream(orderId)).map((event) => event.name);
      assert.deepEqual(payment, ["payment.authorized", "payment.captured"]);

      // The invariant the whole example turns on. `order.paid` sits after
      // `payment.captured`, never after the authorization alone.
      const order = (await api.orderStream(orderId)).map((event) => event.name);
      assert.deepEqual(order, ["order.placed", "order.approved", "order.released", "order.paid"]);
    });

    await check("a permanent decline fails the order and no capture follows", async () => {
      const declined = newId();
      await place(declined, "pm_decline");
      await orderReaching(declined, "pending_approval");
      await api.emit("approve.order", { orderId: declined, approvedBy: "ops@example.com" }, commandMetadata(declined, session));

      const failed = await orderReaching(declined, "payment_failed");
      assert.equal(failed.failureReason, "card_declined");
      assert.deepEqual((await api.paymentStream(declined)).map((e) => e.name), ["payment.declined"]);

      // A decline is final: this example makes one attempt and never retries.
      await staysTrue(
        "the declined order stayed failed, with no second attempt",
        async () => {
          const names = (await api.paymentStream(declined)).map((event) => event.name);
          return names.length === 1 && names[0] === "payment.declined";
        },
      );
    });

    await check("a redelivered command does not place the order twice", async () => {
      await place(orderId, "pm_success");
      await staysTrue(
        "the order stayed placed exactly once",
        async () => (await api.orderStream(orderId)).filter((event) => event.name === "order.placed").length === 1,
      );
    });

    await check("a redelivered order.released does not authorize twice", async () => {
      const released = (await api.orderStream(orderId)).find((event) => event.name === "order.released");
      assert.ok(released, "no order.released to redeliver");
      await api.emit("order.released", released.data, commandMetadata(orderId, session));

      // The gateway's idempotency key is derived from the order, and the append
      // decision refuses a second attempt. Neither alone would be enough.
      await staysTrue(
        "the payment stream stayed at one authorization and one capture",
        async () => {
          const names = (await api.paymentStream(orderId)).map((event) => event.name);
          return names.filter((n) => n === "payment.authorized").length === 1 &&
            names.filter((n) => n === "payment.captured").length === 1;
        },
      );

      // A redelivery starts a *fresh* run with no memoized steps, so the
      // authorize step body really executes again — and still never reaches the
      // gateway, because it reads the payment stream and finds the attempt
      // already recorded before it considers calling out. Zero repeat
      // presentations is the strong claim; the idempotency key is the second
      // line of defence behind it, not the thing doing the work.
      assert.equal(
        gatewayDedupHits(orderId, "authorize"),
        0,
        "a duplicated order.released reached the gateway instead of reading the stream first",
      );
    });

    // Everything above proves the Go and TypeScript halves. This is the Python
    // one: a client-only ConnectRPC subscriber, no worker runtime, resuming
    // from a cursor it persists itself.
    await check("the Python subscriber records one delivery and announces it", async () => {
      const order = await waitFor(
        "notification.sent to reach the read model",
        async () => (await api.projectedOrder(orderId))?.notification,
      );
      assert.equal(order.status, "paid");
      assert.equal(order.channel, "local-log");

      // Ordering announces every status it reaches, so a happy-path order
      // produces three messages. Each is in the log exactly once, and each emit
      // was acknowledged — the two halves of the crash window between them.
      const logged = deliveries(orderId);
      assert.deepEqual(
        logged.map((row) => row.status),
        ["pending_approval", "processing_payment", "paid"],
        `unexpected delivery log: ${JSON.stringify(logged)}`,
      );
      assert.ok(
        logged.every((row) => row.emitted === 1),
        `a delivery was committed but its notification.sent was never acknowledged: ${JSON.stringify(logged)}`,
      );

      // The timeline labels the fact with the service and language that made
      // it, which the projection reads off the metadata this service sends.
      // Found by name, not by position: the checks above replay an
      // `order.released`, which lands after it.
      const timeline = (await api.projectedOrder(orderId)).timeline;
      const entry = timeline.find((item) => item.event === "notification.sent");
      assert.ok(entry, `no notification.sent in the timeline: ${JSON.stringify(timeline.map((i) => i.event))}`);
      assert.equal(entry.producer, "notifications-python");
      assert.equal(entry.language, "Python");
    });

    await check("a redelivered order-status message is not delivered twice", async () => {
      const before = deliveries(orderId).at(-1);
      // Republish the same message. Its ID is derived from the order and the
      // status it announces, so the subscriber recognises it rather than
      // guessing.
      await api.publish("notifications.order-status", {
        messageId: before.message_id,
        orderId,
        status: "paid",
        customerEmail: "ada@example.com",
        occurredAt: new Date().toISOString(),
      });
      await staysTrue(
        "the delivery log stayed at three rows for this order",
        async () => deliveries(orderId).length === 3,
      );
    });

    // The join /system and the timeline depend on, which no unit test can
    // check: a fake stipulates both sides of it. The projection's own event ids
    // are NOT the ids runs are keyed by — a managed projection sees the outbox
    // entry's id on the live path — so the link is resolved by order instead,
    // and this is what proves that side still holds.
    await check("the runs behind an order are findable from what the browser can read", async () => {
      const runs = await api.runs({ limit: "100" });
      const mine = runs.filter((run) => run.input?.orderId === orderId);
      assert.ok(
        mine.length > 0,
        `no run records an input orderId matching ${orderId}; the timeline's run links resolve nothing`,
      );
      assert.ok(
        mine.some((run) => run.function_id === "place-order"),
        `the order's runs are ${mine.map((run) => run.function_id).join(", ")}, with no place-order`,
      );

      // And the trap this replaced: the projection's event ids share no values
      // with the run list, so a lookup joining them silently finds nothing.
      const projected = await api.projectedOrder(orderId);
      const timelineIds = new Set(projected.timeline.map((entry) => entry.eventId).filter(Boolean));
      assert.ok(timelineIds.size > 0, "the projection recorded no event ids at all");
      assert.equal(
        runs.filter((run) => timelineIds.has(run.event_id)).length,
        0,
        "run.event_id now matches the projection's event ids — the by-order join can be simplified",
      );
    });

    // The operations view polls this REST route straight from the page, which
    // sits on a different port from the engine — so it is a cross-origin
    // request, and it is the only browser call in this example that does not go
    // through the ConnectRPC transport. If the engine's CORS middleware ever
    // stops covering REST routes, the worker indicator disappears with no error
    // anywhere: `listWorkers` throws, the hook reports "unknown", and the view
    // renders nothing.
    await check("the worker list is readable from the page's origin", async () => {
      assert.ok(webUrl, "the supervisor printed no web URL");
      const response = await fetch(`${url}/api/v1/workers`, {
        headers: { ...api.headers, origin: webUrl, "x-ironflow-environment": "default" },
      });
      assert.equal(response.status, 200);
      assert.ok(
        response.headers.get("access-control-allow-origin"),
        "no Access-Control-Allow-Origin — the payment worker indicator cannot load",
      );
      const running = (await response.json()).workers ?? [];
      assert.ok(
        running.some((worker) => (worker.function_ids ?? []).includes(PAYMENT_FUNCTION_ID)),
        "no worker is listed for the payment function",
      );
    });

    await check("the shop is served on its own discovered port", async () => {
      assert.ok(webUrl, "the supervisor printed no web URL");
      const response = await fetch(`${webUrl}/shop`);
      assert.equal(response.status, 200);
      const html = await response.text();
      // The local-demo label is not decoration: this page talks to an engine
      // with authentication disabled and has to say so.
      assert.match(html, /never a production pattern/);
    });

    await check("the control plane authenticates and refuses a service it does not supervise", async () => {
      // Only the payment worker is crashable. Both refusals matter: a
      // supervised-but-protected service and an unknown name.
      await assert.rejects(
        sendControl("crash", "notifications", { file: SUPERVISOR_FILE }),
        /notifications is not a crashable service/,
      );
      await assert.rejects(sendControl("crash", "nothing-here", { file: SUPERVISOR_FILE }), /no such service/);
      // The engine is supervised but not crashable. Taking it down would prove
      // nothing about durable replay.
      await assert.rejects(sendControl("crash", "engine", { file: SUPERVISOR_FILE }), /not a crashable service/);
      // The token is the credential, not the loopback port.
      const meta = JSON.parse(readFileSync(SUPERVISOR_FILE, "utf8"));
      const forged = await fetch(`http://127.0.0.1:${meta.port}/control`, {
        method: "POST",
        headers: { authorization: "Bearer forged" },
        body: "{}",
      });
      assert.equal(forged.status, 401);
    });

    await check("shutdown leaves no engine and no handshake file", async () => {
      assert.equal(await supervisor.stop(), 0);
      assert.equal(existsSync(SUPERVISOR_FILE), false);
      await assert.rejects(fetch(`${url}/ready`), "the engine still answers after shutdown");
    });

    process.stdout.write("reference-app live gate passed\n");
    // Clean only on success: a failed run leaves its engine database and logs
    // behind on purpose, for whoever has to work out what happened.
    rmSync(LIVE_DATA, { recursive: true, force: true });
  } catch (error) {
    if (supervisor) await supervisor.stop();
    process.stderr.write(
      `\nreference-app live gate FAILED: ${error.message}\n\n--- supervisor log ---\n${redact(supervisor?.text() ?? "")}\n`,
    );
    process.stderr.write(`state kept at ${LIVE_DATA}\n`);
    process.exitCode = 1;
  }
}

await main();
