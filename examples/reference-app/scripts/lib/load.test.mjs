import { strict as assert } from "node:assert";
import test from "node:test";

import { listRunsSnapshot, projectedFactCount, runsByStatus } from "./load.mjs";

test("listRunsSnapshot reads every run page", async () => {
  const all = Array.from({ length: 2_505 }, (_, i) => ({ id: `run-${i}`, status: i % 2 ? "waiting" : "completed" }));
  const requested = [];
  const api = {
    async runsPage(query) {
      const offset = Number(query.offset);
      const limit = Number(query.limit);
      requested.push({ offset, limit });
      return { runs: all.slice(offset, offset + limit), total_count: all.length };
    },
  };

  const snapshot = await listRunsSnapshot(api);

  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.totalCount, all.length);
  assert.equal(snapshot.runs.length, all.length);
  assert.deepEqual(requested, [
    { offset: 0, limit: 1_000 },
    { offset: 1_000, limit: 1_000 },
    { offset: 2_000, limit: 1_000 },
  ]);
});

test("listRunsSnapshot marks a moving result incomplete instead of claiming it is exhaustive", async () => {
  let call = 0;
  const api = {
    async runsPage() {
      call++;
      return { runs: [{ id: "same", status: "running" }], total_count: 2 };
    },
  };

  const snapshot = await listRunsSnapshot(api, {}, { pageSize: 1, maxPasses: 2 });

  assert.equal(snapshot.complete, false);
  assert.equal(snapshot.totalCount, 2);
  assert.equal(snapshot.runs.length, 1);
  assert.equal(call, 4);
});

test("load reporting helpers count statuses and projected facts", () => {
  assert.deepEqual(
    runsByStatus([{ status: "waiting" }, { status: "completed" }, { status: "waiting" }]),
    { waiting: 2, completed: 1 },
  );
  assert.equal(projectedFactCount({ timeline: [{ event: "notification.sent" }, { event: "order.paid" }] }, "notification.sent"), 1);
  assert.equal(projectedFactCount(undefined, "notification.sent"), 0);
});
