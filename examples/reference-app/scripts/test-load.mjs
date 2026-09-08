#!/usr/bin/env node
// The load gate: the whole polyglot system under a burst, on the real engine.
//
// This is not a throughput benchmark. `tests/loadtest/` already measures raw
// engine throughput with k6 against synthetic functions, and it has a committed
// baseline; repeating that here would be worth nothing. What k6's synthetic
// functions structurally cannot see is what this drives:
//
//   - three language runtimes contending on one engine at once (a Go worker, a
//     Node worker and a client-only Python subscriber)
//   - `waitForEvent` at depth: hundreds of runs parked on the approval wait,
//     held, then released in one burst
//   - optimistic-concurrency retries on a real entity stream, from concurrent
//     duplicate approvals
//   - two streams and a projection converging per order
//   - the at-least-once notification path falling behind, which is invisible
//     anywhere else because `announce` logs and drops its publish failures
//   - duplicate external side effects, counted in the gateway's own ledger
//
// TWO LANES, AND THE DIFFERENCE MATTERS.
//
// The `orders` projection is one unpartitioned state document holding every
// order, rewritten on every fact — a deliberate choice, marked `ponytail:` in
// services/orders-go/internal/order/projection.go, because the browser SDK
// cannot enumerate a partitioned projection's partitions. It is O(n) per fact
// and it will degrade here long before anything in the engine does. So:
//
//   APP LANE     projection convergence and read latency. Reported, never
//                gated. Degradation is this example's own documented design.
//   ENGINE LANE  command -> fact latency, worker pickup, durable-step spans,
//                stream conflicts. This is the "is the engine healthy" signal.
//
// Collapsing the two would make every run blame Ironflow for a comment already
// in the source.
//
// WHAT IT GATES ON: scale-invariant properties only — one authorization and one
// capture per order, zero repeat presentations to the gateway, every order
// terminal, every notification delivered exactly once, no silently dropped
// publish. Timings are printed as a table and asserted on by nothing. A timing
// gate needs a committed baseline, building one duplicates
// tests/loadtest/baseline.json, and it would flake on a loaded laptop.
//
// SQLite, single writer, and `--dev` — see the header the report prints.
import { strict as assert } from "node:assert";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { DatabaseSync } from "node:sqlite";

import { DATA_DIR } from "./lib/control.mjs";
import { checker, commandMetadata, engineApi, newId, redact, startSupervisor, staysTrue } from "./lib/live.mjs";
import { listRunsSnapshot, projectedFactCount, runsByStatus } from "./lib/load.mjs";
import { waitFor } from "./lib/readiness.mjs";

const LOAD_DATA = join(DATA_DIR, "load-test");

/** `--orders=500` and `--orders 500` both. */
function arg(name, fallback) {
  const argv = process.argv.slice(2);
  const inline = argv.find((a) => a.startsWith(`--${name}=`));
  if (inline) return Number(inline.split("=")[1]);
  const index = argv.indexOf(`--${name}`);
  if (index >= 0 && argv[index + 1] !== undefined) return Number(argv[index + 1]);
  return fallback;
}

const ORDERS = arg("orders", 200);
// Per second. The place burst is paced; the release burst deliberately is not —
// releasing is where the parked runs all wake at once, which is the point.
const RATE = arg("rate", 20);
// How long the parked approval waits are held before the release burst. Long
// enough that a wait which releases itself has time to do so.
const SOAK_MS = arg("soak", 5_000);
// Orders whose approval is sent twice, concurrently, to force a version
// conflict on the same entity stream.
const CONFLICTS = arg("conflicts", 10);
// Every Nth order is declined by the gateway, so the failure path carries load
// too and the terminal state is not uniform.
const DECLINE_EVERY = arg("decline-every", 5);

// In-flight HTTP cap for the unpaced phases. High enough to be a burst, low
// enough not to measure the driver's own socket exhaustion.
const POOL = 32;

// Scaled: the release burst wakes every parked run at once, and the projection
// rewrite is O(orders) per fact.
const CONVERGE_MS = 60_000 + ORDERS * 750;
const DELIVERY_MS = 60_000 + ORDERS * 250;

// Ordering announces one message per status it reaches, and every order passes
// through three: pending_approval, processing_payment, and its terminal state.
// scripts/test-live.mjs asserts exactly that list for a single happy-path order.
const DELIVERIES_PER_ORDER = 3;
const APPROVAL_PROCESS_FUNCTION_ID = "order-approval-process";
const APPROVE_FUNCTION_ID = "approve-order";
const APPROVAL_WAIT_STEP_ID = "wait-approval";

const check = checker();
const log = (line) => process.stdout.write(`${line}\n`);

/** Run `fn` over `items` with at most `limit` in flight, preserving order. */
async function pooled(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * The event's own clock, whatever the wire calls it.
 *
 * ReadStream's field name is not pinned by anything this script can import, and
 * a wrong guess would silently produce NaN latencies rather than an error.
 */
function eventTime(event) {
  for (const key of ["timestamp", "created_at", "createdAt", "occurred_at", "occurredAt"]) {
    const value = event?.[key];
    if (value === undefined || value === null) continue;
    const ms = typeof value === "number" ? value : Date.parse(value);
    if (Number.isFinite(ms)) return ms;
  }
  return undefined;
}

/** p50/p95/max over a sample, in ms. Undefined entries are dropped. */
function summarize(samples) {
  const values = samples.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (values.length === 0) return undefined;
  const at = (q) => values[Math.min(values.length - 1, Math.floor(q * values.length))];
  return { n: values.length, p50: at(0.5), p95: at(0.95), max: values[values.length - 1] };
}

function table(rows) {
  const shown = rows.filter((row) => row.stats);
  if (shown.length === 0) return "  (no samples)";
  const width = Math.max(...shown.map((row) => row.label.length));
  return shown
    .map(({ label, stats }) =>
      `  ${label.padEnd(width)}  n=${String(stats.n).padStart(4)}  ` +
      `p50 ${String(Math.round(stats.p50)).padStart(6)}ms  ` +
      `p95 ${String(Math.round(stats.p95)).padStart(6)}ms  ` +
      `max ${String(Math.round(stats.max)).padStart(6)}ms`,
    )
    .join("\n");
}

/** The payment worker's own ledger: one row per call it really made. */
function gateway(sql, ...params) {
  const db = new DatabaseSync(join(LOAD_DATA, "payments-gateway.db"), { readOnly: true });
  try {
    return db.prepare(sql).all(...params);
  } finally {
    db.close();
  }
}

/** The Python subscriber's own delivery log. */
function notifications(sql, ...params) {
  const path = join(LOAD_DATA, "notifications.db");
  if (!existsSync(path)) return [];
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db.prepare(sql).all(...params);
  } finally {
    db.close();
  }
}

async function main() {
  // A fresh directory, for the reason tests/loadtest/run.sh records: a previous
  // run's parked waits and accumulated runs change the next run's numbers by
  // more than the change under test would.
  rmSync(LOAD_DATA, { recursive: true, force: true });

  const session = newId();
  const orders = Array.from({ length: ORDERS }, (_, i) => ({
    id: newId(),
    declines: DECLINE_EVERY > 0 && i % DECLINE_EVERY === DECLINE_EVERY - 1,
    conflicts: i < CONFLICTS,
  }));
  const conflictOrders = orders.filter((order) => order.conflicts);

  let supervisor;
  try {
    log(`reference-app load gate — ${ORDERS} orders at ~${RATE}/s, ${conflictOrders.length} conflicting approvals`);
    supervisor = await startSupervisor({
      dataDir: LOAD_DATA,
      // The web application is a second client polling the whole read model
      // every 2s. Not started here; see dev.mjs.
      env: {
        REFERENCE_APP_SKIP_WEB: "1",
        // The order worker's load-only Streams wrapper synchronizes these
        // duplicate appends after both handlers have read the same version.
        REFERENCE_APP_APPROVAL_CONFLICT_ORDERS: conflictOrders.map((order) => order.id).join(","),
        // One slot beyond every possible first half prevents the probe barrier
        // from occupying the whole worker before a duplicate can join it.
        REFERENCE_APP_ORDER_MAX_CONCURRENT_JOBS: String(Math.max(10, conflictOrders.length + 1)),
      },
    });
    const { url, apiKey } = supervisor;
    const api = engineApi({ url, apiKey });

    const terminalOf = (order) => (order.declines ? "payment_failed" : "paid");

    const printRunSnapshot = (stage, snapshot) => {
      if (!snapshot || snapshot.runs.length === 0) return;
      const coverage = snapshot.complete
        ? `${snapshot.runs.length}/${snapshot.totalCount} runs`
        : `${snapshot.runs.length}/${snapshot.totalCount} runs, incomplete moving snapshot`;
      log(`   runs by status ${stage} (${coverage}): ${JSON.stringify(runsByStatus(snapshot.runs))}`);
    };

    /**
     * One poll of the read model, indexed.
     *
     * projectedOrders() returns every order in one document — the same single
     * read the browser makes. Asking it once per order would be O(n^2) driver
     * work against an O(n) response, and the driver would become the load.
     */
    const pollProjection = async () => {
      const projected = await api.projectedOrders();
      // Visibility is observed only when the response arrives. Stamping before
      // the request can predate a fact that became visible while it was read.
      return { at: Date.now(), projected };
    };

    // ---------------------------------------------------------------- phase A
    log(`\nA. placing ${ORDERS} orders`);
    const placeErrors = [];
    const placeStart = Date.now();
    for (const order of orders) {
      order.placeSentAt = Date.now();
      // Not awaited: pacing is the interval below, so a slow response must not
      // push the arrival rate down and quietly turn a burst into a trickle.
      order.placed = api
        .emit(
          "place.order",
          {
            orderId: order.id,
            customerEmail: "load@example.com",
            items: [{ sku: "sku_desk_lamp", quantity: 1 }, { sku: "sku_notebook", quantity: 2 }],
            totalCents: 6900,
            currency: "USD",
            paymentMethodToken: order.declines ? "pm_decline" : "pm_success",
          },
          commandMetadata(order.id, session),
        )
        .catch((error) => placeErrors.push(`${order.id}: ${error.message}`));
      await sleep(1000 / RATE);
    }
    await Promise.all(orders.map((order) => order.placed));
    const placeElapsed = Date.now() - placeStart;
    log(`   sent in ${placeElapsed}ms (~${(ORDERS / (placeElapsed / 1000)).toFixed(1)}/s achieved)`);

    // A rejected command is not backpressure the caller can ride out — the
    // order simply never happens, and the convergence wait below would then
    // fail much later with a far worse message than this one.
    await check("every place.order command was accepted", () => {
      assert.equal(
        placeErrors.length,
        0,
        `${placeErrors.length}/${ORDERS} place.order commands were rejected:\n  ${placeErrors.slice(0, 5).join("\n  ")}`,
      );
    });

    await check("every order reaches the read model waiting for approval", async () => {
      await waitFor(
        `all ${ORDERS} orders to reach pending_approval`,
        async () => {
          const { at, projected } = await pollProjection();
          let ready = 0;
          for (const order of orders) {
            const row = projected[order.id];
            if (row?.status !== "pending_approval") continue;
            order.pendingSeenAt ??= at;
            ready++;
          }
          return ready === ORDERS;
        },
        { timeoutMs: CONVERGE_MS, intervalMs: 250 },
      );
    });

    await check("every approval process parks its durable wait", async () => {
      const expected = new Set(orders.map((order) => order.id));
      const parkedByOrder = new Map();
      await waitFor(
        `all ${ORDERS} wait-approval steps to reach waiting`,
        async () => {
          const snapshot = await listRunsSnapshot(api, { function_id: APPROVAL_PROCESS_FUNCTION_ID });
          const candidates = snapshot.runs.filter((run) => expected.has(run.input?.orderId));
          await pooled(candidates, POOL, async (run) => {
            const orderID = run.input?.orderId;
            if (!orderID || parkedByOrder.has(orderID)) return;
            const steps = await api.runSteps(run.id);
            if (steps.some((step) =>
              step.step_id.includes(`:${APPROVAL_WAIT_STEP_ID}:`) &&
              step.wait_event_name === "order.approved" &&
              step.status === "waiting",
            )) {
              parkedByOrder.set(orderID, run.id);
            }
          });
          if (parkedByOrder.size === expected.size) return true;
          throw new Error(
            `${parkedByOrder.size}/${expected.size} waits parked; ` +
            `run snapshot held ${snapshot.runs.length}/${snapshot.totalCount}${snapshot.complete ? "" : " and was incomplete"}`,
          );
        },
        { timeoutMs: CONVERGE_MS, intervalMs: 250 },
      );
    });

    // ---------------------------------------------------------------- phase B
    log(`\nB. holding ${ORDERS} parked approval waits for ${SOAK_MS}ms`);
    const soakStart = Date.now();
    await check("no durable wait releases itself while nothing approves", async () => {
      // staysTrue, not a sleep: a sleep followed by one read passes whenever the
      // engine is merely slower than the sleep.
      await staysTrue(
        "every order stayed at pending_approval",
        async () => {
          const { projected } = await pollProjection();
          return orders.every((order) => projected[order.id]?.status === "pending_approval");
        },
        { windowMs: SOAK_MS, intervalMs: 500 },
      );
    });

    // The requested window is a floor, not the hold: staysTrue checks its
    // deadline only between probes, so a slow probe extends the real soak. Any
    // span that starts before this and ends after it carries the difference.
    const soakElapsed = Date.now() - soakStart;
    log(`   held for ${soakElapsed}ms`);

    const parked = await listRunsSnapshot(api).catch(() => undefined);
    printRunSnapshot("while parked", parked);

    // ---------------------------------------------------------------- phase C
    log(`\nC. releasing all ${ORDERS} waits at once`);
    const approveErrors = [];
    const approveStart = Date.now();
    await pooled(orders, POOL, async (order) => {
      order.approveSentAt = Date.now();
      const send = () =>
        api.emit("approve.order", { orderId: order.id, approvedBy: "load@example.com" }, commandMetadata(order.id, session));
      try {
        // A conflicting order sends the same approval twice. The load-only
        // stream wrapper holds both appends after their reads, so one must lose
        // the expected-version check and retry.
        await (order.conflicts ? Promise.all([send(), send()]) : send());
      } catch (error) {
        approveErrors.push(`${order.id}: ${error.message}`);
      }
    });
    const approveElapsed = Date.now() - approveStart;
    log(`   sent in ${approveElapsed}ms`);

    await check("every approve.order command was accepted", () => {
      assert.equal(
        approveErrors.length,
        0,
        `${approveErrors.length} approve.order commands were rejected:\n  ${approveErrors.slice(0, 5).join("\n  ")}`,
      );
    });

    // ---------------------------------------------------------------- phase D
    log("\nD. converging");
    // Sampled here, not only during the soak: the soak measures runs sitting
    // still, and the interesting question is what the queue looks like while it
    // drains. A large waiting_for_capacity here is the engine-lane cause behind
    // whatever the spans below report.
    let drain;
    await check("every order reaches a terminal status", async () => {
      await waitFor(
        `all ${ORDERS} orders to reach a terminal status`,
        async () => {
          drain ??= await listRunsSnapshot(api).catch(() => undefined);
          const { at, projected } = await pollProjection();
          const stuck = [];
          for (const order of orders) {
            const row = projected[order.id];
            if (row?.status === terminalOf(order)) order.terminalSeenAt ??= at;
            else stuck.push(`${order.id}=${row?.status ?? "absent"}`);
          }
          if (stuck.length === 0) return true;
          // Named, not counted: a converge timeout has to say which orders are
          // stuck and in what status, or it is unactionable.
          throw new Error(`${stuck.length} not terminal, e.g. ${stuck.slice(0, 5).join(", ")}`);
        },
        { timeoutMs: CONVERGE_MS, intervalMs: 250 },
      );
    });

    printRunSnapshot("while draining", drain);

    // ------------------------------------------------------------ the streams
    // One read per order, after the load, not during it: this is measurement,
    // and it must not become part of what is measured.
    log("\n   reading streams");
    await pooled(orders, POOL, async (order) => {
      order.order = await api.orderStream(order.id);
      order.payment = await api.paymentStream(order.id);
    });
    const factAt = (order, stream, name) => eventTime(order[stream].find((event) => event.name === name));

    // ------------------------------------------------------------- the gates
    await check("each order's stream holds exactly one of each fact", () => {
      for (const order of orders) {
        const names = order.order.map((event) => event.name);
        const expected = order.declines
          ? ["order.placed", "order.approved", "order.released", "order.payment_failed"]
          : ["order.placed", "order.approved", "order.released", "order.paid"];
        assert.deepEqual(names, expected, `order ${order.id} stream is ${names.join(", ")}`);
      }
    });

    await check("a concurrent duplicate approval never appends a second fact", () => {
      // The gate the conflict probe exists for. Both runs raced the same
      // expected version; only one may have won.
      for (const order of orders.filter((o) => o.conflicts)) {
        const approvals = order.order.filter((event) => event.name === "order.approved");
        assert.equal(approvals.length, 1, `order ${order.id} was approved ${approvals.length} times`);
      }
    });

    await check("each duplicate approval causes an optimistic conflict and retry", async () => {
      let snapshot;
      await waitFor(
        "every conflicting approval run to retry",
        async () => {
          snapshot = await listRunsSnapshot(api, { function_id: APPROVE_FUNCTION_ID });
          const output = supervisor.text();
          const pending = conflictOrders.filter((order) => {
            const runs = snapshot.runs.filter((run) => run.input?.orderId === order.id);
            const marker = `load approval conflict observed: order=${order.id}`;
            return runs.length !== 2 || !runs.some((run) => run.attempt > 1) || !output.includes(marker);
          });
          if (pending.length === 0) return true;
          throw new Error(`${pending.length}/${conflictOrders.length} conflict probes have not retried`);
        },
        { timeoutMs: CONVERGE_MS, intervalMs: 250 },
      );

      assert.ok(snapshot.complete, `approval run snapshot held ${snapshot.runs.length}/${snapshot.totalCount} runs`);
      const output = supervisor.text();
      for (const order of conflictOrders) {
        const runs = snapshot.runs.filter((run) => run.input?.orderId === order.id);
        assert.equal(runs.length, 2, `order ${order.id} has ${runs.length} approval runs, expected 2`);
        assert.ok(
          runs.some((run) => run.attempt > 1),
          `order ${order.id} recorded no retried approval run: ${runs.map((run) => run.attempt).join(", ")}`,
        );
        const marker = `load approval conflict observed: order=${order.id}`;
        assert.equal(output.split(marker).length - 1, 1, `order ${order.id} did not record exactly one version conflict`);
      }
    });

    await check("one authorization and one capture per order, and none for a decline", () => {
      for (const order of orders) {
        const names = order.payment.map((event) => event.name);
        const expected = order.declines ? ["payment.declined"] : ["payment.authorized", "payment.captured"];
        assert.deepEqual(names, expected, `payment ${order.id} stream is ${names.join(", ")}`);
      }
    });

    await check("no order was presented to the gateway twice", () => {
      // The strong claim, read from the gateway's own ledger rather than
      // inferred from timing: a repeat presentation is counted even when the
      // idempotency key stops it from charging twice.
      const [{ hits }] = gateway("SELECT COALESCE(SUM(dedup_hits), 0) AS hits FROM gateway_calls");
      assert.equal(Number(hits), 0, `the gateway saw ${hits} repeat presentations under load`);
      const [{ calls }] = gateway("SELECT COUNT(*) AS calls FROM gateway_calls");
      const expected = orders.filter((o) => !o.declines).length * 2 + orders.filter((o) => o.declines).length;
      assert.equal(Number(calls), expected, `the gateway made ${calls} calls, expected ${expected}`);
    });

    await check("no order-status notification was silently dropped", () => {
      // `announce` logs and drops its publish errors on purpose — notification
      // is not an order invariant — so the absence of this line is the only
      // evidence the topic held up under the burst.
      const failures = supervisor.text().match(/publishing the .* notification failed/g) ?? [];
      assert.equal(failures.length, 0, `${failures.length} order-status publishes failed`);
    });

    await check("the Python subscriber delivers every message exactly once", async () => {
      const expected = ORDERS * DELIVERIES_PER_ORDER;
      const total = () => Number(notifications("SELECT COUNT(*) AS n FROM deliveries")[0]?.n ?? 0);
      await waitFor(
        `${expected} deliveries to drain`,
        () => {
          const seen = total();
          if (seen >= expected) return true;
          throw new Error(`${seen}/${expected} delivered — the subscriber is behind or lost a message`);
        },
        { timeoutMs: DELIVERY_MS, intervalMs: 500 },
      );
      assert.equal(total(), expected, "the subscriber delivered more rows than were published");
      const dupes = notifications(
        "SELECT message_id, COUNT(*) AS n FROM deliveries GROUP BY message_id HAVING n > 1",
      );
      assert.equal(dupes.length, 0, `${dupes.length} message ids were delivered twice`);
      const unacked = notifications("SELECT COUNT(*) AS n FROM deliveries WHERE emitted != 1")[0]?.n ?? 0;
      assert.equal(Number(unacked), 0, `${unacked} deliveries were committed but never acknowledged`);
    });

    await check("every notification fact reaches the order projection", async () => {
      await waitFor(
        `${ORDERS * DELIVERIES_PER_ORDER} notification.sent facts to reach the read model`,
        async () => {
          const { projected } = await pollProjection();
          const behind = orders.filter(
            (order) => projectedFactCount(projected[order.id], "notification.sent") < DELIVERIES_PER_ORDER,
          );
          if (behind.length === 0) return true;
          throw new Error(
            `${behind.length} orders are behind, e.g. ` +
            behind.slice(0, 5).map((order) =>
              `${order.id}=${projectedFactCount(projected[order.id], "notification.sent")}/${DELIVERIES_PER_ORDER}`,
            ).join(", "),
          );
        },
        { timeoutMs: DELIVERY_MS, intervalMs: 250 },
      );

      const projected = await api.projectedOrders();
      for (const order of orders) {
        assert.equal(
          projectedFactCount(projected[order.id], "notification.sent"),
          DELIVERIES_PER_ORDER,
          `order ${order.id} projected the wrong number of notification.sent facts`,
        );
      }
    });

    // ------------------------------------------------------------- the report
    const engineLane = [
      {
        label: "place.order sent -> order.placed",
        stats: summarize(orders.map((o) => factAt(o, "order", "order.placed") - o.placeSentAt)),
      },
      {
        label: "approve.order sent -> order.approved",
        stats: summarize(orders.map((o) => factAt(o, "order", "order.approved") - o.approveSentAt)),
      },
      {
        label: "order.approved -> order.released (wait)",
        stats: summarize(orders.map((o) => factAt(o, "order", "order.released") - factAt(o, "order", "order.approved"))),
      },
      {
        label: "order.released -> payment worker pickup",
        stats: summarize(
          orders
            .filter((o) => !o.declines)
            .map((o) => factAt(o, "payment", "payment.authorized") - factAt(o, "order", "order.released")),
        ),
      },
      {
        label: "authorize -> capture (durable steps)",
        stats: summarize(
          orders
            .filter((o) => !o.declines)
            .map((o) => factAt(o, "payment", "payment.captured") - factAt(o, "payment", "payment.authorized")),
        ),
      },
      {
        label: "payment.captured -> order.paid",
        stats: summarize(
          orders
            .filter((o) => !o.declines)
            .map((o) => factAt(o, "order", "order.paid") - factAt(o, "payment", "payment.captured")),
        ),
      },
      {
        // From the release, not from order.placed: an order placed early in
        // phase A sits through the rest of the burst and the whole soak before
        // anything approves it, so a span starting at order.placed would be
        // mostly this script's own pacing.
        label: "order.released -> terminal fact",
        stats: summarize(
          orders.map(
            (o) => factAt(o, "order", o.declines ? "order.payment_failed" : "order.paid") - factAt(o, "order", "order.released"),
          ),
        ),
      },
    ];

    /**
     * How wide a window one fact type landed in, across every order.
     *
     * This is what separates a real queue from a measurement artifact. A stage
     * the engine drains over time spreads its facts over seconds; a stage whose
     * facts all carry one stamp spans milliseconds no matter how many orders
     * there are, and any latency computed from it is an artifact of that stamp
     * rather than work the engine did.
     */
    const spread = (stream, name) => {
      const times = orders.map((o) => factAt(o, stream, name)).filter((t) => Number.isFinite(t));
      if (times.length === 0) return "—";
      const ms = Math.max(...times) - Math.min(...times);
      return `${(ms / 1000).toFixed(2)}s`;
    };

    const readStart = Date.now();
    const finalRead = await api.projectedOrders();
    const readMs = Date.now() - readStart;
    const readBytes = JSON.stringify(finalRead).length;

    const appLane = [
      {
        label: "terminal fact -> visible in read model",
        stats: summarize(
          orders.map(
            (o) => o.terminalSeenAt - factAt(o, "order", o.declines ? "order.payment_failed" : "order.paid"),
          ),
        ),
      },
    ];

    log(`
================================================================
reference-app load report
  ${ORDERS} orders, ~${(ORDERS / (placeElapsed / 1000)).toFixed(1)}/s placed, ${orders.filter((o) => o.declines).length} declined, ${conflictOrders.length} with a concurrent duplicate approval
  release burst: ${ORDERS} approvals in ${approveElapsed}ms

  Measured against SQLite (single writer) with the engine in --dev
  (authentication short-circuited). Both are what a presenter runs, and
  neither is what production runs — see tests/loadtest/run.sh for the
  PostgreSQL, authenticated equivalent at the engine level.

ENGINE LANE — gated on correctness, timings informational
${table(engineLane)}

APP LANE — informational only; degradation here is this example's own
design (one unpartitioned projection document, ponytail: in projection.go)
${table(appLane)}
  read model after ${ORDERS} orders: ${(readBytes / 1024).toFixed(0)}KB in ${readMs}ms for one read
  projection visibility uses response time; uncertainty is one 250ms polling interval plus read time

FACT ARRIVAL SPREAD — first to last, across all ${ORDERS} orders. A span whose
end fact has a spread near zero did not measure a queue draining; every order's
fact carries one stamp, and the span is that stamp minus a start time.
  order.placed       ${spread("order", "order.placed")}
  order.approved     ${spread("order", "order.approved")}
  order.released     ${spread("order", "order.released")}
  payment.authorized ${spread("payment", "payment.authorized")}
  payment.captured   ${spread("payment", "payment.captured")}
  order.paid         ${spread("order", "order.paid")}
  (phase A sent over ${(placeElapsed / 1000).toFixed(2)}s, phase C over ${(approveElapsed / 1000).toFixed(2)}s, soak held ${(soakElapsed / 1000).toFixed(2)}s)
================================================================`);

    await check("shutdown leaves no engine behind", async () => {
      await supervisor.stop();
      await assert.rejects(fetch(`${url}/ready`), "the engine still answers after shutdown");
    });

    process.stdout.write("\nreference-app load gate passed\n");
    // Clean only on success, the same contract the other live gates keep.
    rmSync(LOAD_DATA, { recursive: true, force: true });
  } catch (error) {
    if (supervisor) await supervisor.stop();
    process.stderr.write(
      `\nreference-app load gate FAILED: ${error.message}\n\n--- supervisor log ---\n${redact(supervisor?.tail() ?? "")}\n`,
    );
    process.stderr.write(`state kept at ${LOAD_DATA}\n`);
    process.exitCode = 1;
  }
}

await main();
