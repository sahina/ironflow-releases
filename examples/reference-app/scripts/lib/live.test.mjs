import { strict as assert } from "node:assert";
import { test } from "node:test";

import { engineApi } from "./live.mjs";

test("projectedOrders sends one valid JSON content type", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url, options) => {
    assert.equal(url, "http://engine/ironflow.v1.ProjectionService/GetProjection");
    assert.deepEqual(
      Object.keys(options.headers).filter((name) => name.toLowerCase() === "content-type"),
      ["content-type"],
    );
    assert.equal(options.headers["content-type"], "application/json");
    assert.deepEqual(JSON.parse(options.body), { name: "orders" });
    return new Response(JSON.stringify({ state: { orders: { "order-1": { status: "pending_approval" } } } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const orders = await engineApi({ url: "http://engine", apiKey: "test-key" }).projectedOrders();
  assert.deepEqual(orders, { "order-1": { status: "pending_approval" } });
});
