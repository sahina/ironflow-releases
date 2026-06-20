"use client";

import { useEffect, useRef, useState } from "react";
import { ironflow } from "../lib/ironflow-browser";
import type { Subscription } from "@ironflow/browser";
import type {
  CustomerOrdersListState,
} from "../lib/types";

const DEMO_CUSTOMERS = [
  { id: "cust-001", name: "Ada Lovelace" },
  { id: "cust-002", name: "Grace Hopper" },
];

const DEMO_PRODUCTS = [
  { id: "prod-widget", name: "Widget (12.50)" },
  { id: "prod-gadget", name: "Gadget (24.99)" },
  { id: "prod-gizmo", name: "Gizmo (7.25)" },
];

export default function PlaceOrderPage() {
  const [customerId, setCustomerId] = useState(DEMO_CUSTOMERS[0].id);
  const [productId, setProductId] = useState(DEMO_PRODUCTS[0].id);
  const [qty, setQty] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [dashboard, setDashboard] = useState<CustomerOrdersListState | null>(
    null,
  );
  const subRef = useRef<Subscription | null>(null);

  useEffect(() => {
    let cancelled = false;

    // A projection partition with no events yet returns `state: {}` (no
    // `orders` key). Normalize so the UI always has an array to render.
    const normalize = (
      s: Partial<CustomerOrdersListState> | null | undefined,
    ): CustomerOrdersListState => ({ orders: s?.orders ?? [] });

    async function load() {
      try {
        const initial = await ironflow.getProjection<CustomerOrdersListState>(
          "customer-orders-list",
          { partition: customerId },
        );
        if (!cancelled) setDashboard(normalize(initial.state));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!cancelled && !msg.includes("404")) setError(msg);
      }

      try {
        const sub = await ironflow.subscribeToProjection<CustomerOrdersListState>(
          "customer-orders-list",
          {
            onUpdate: (state) => setDashboard(normalize(state)),
            onError: (err) =>
              setError(err instanceof Error ? err.message : String(err)),
          },
          { partition: customerId },
        );
        if (cancelled) (sub as Subscription).unsubscribe();
        else subRef.current = sub as Subscription;
      } catch {
        // subscription unsupported — the initial fetch already populated state
      }
    }

    load();
    return () => {
      cancelled = true;
      subRef.current?.unsubscribe();
      subRef.current = null;
    };
  }, [customerId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    setError(null);

    const orderId = `ord-${Date.now().toString(36)}`;
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          customerId,
          items: [{ productId, qty }],
          shippingAddress: {
            street: "1 Demo St",
            city: "Sampletown",
            zip: "00000",
            country: "US",
          },
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setMessage(
        `Accepted (202). orderId=${body.orderId} commandId=${body.commandId}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-2xl font-bold">Place Order</h2>
        <p className="text-gray-500 text-sm mt-1">
          POSTs to{" "}
          <code className="bg-gray-100 px-1 rounded">/api/orders</code>. The
          route authenticates, builds a <code className="bg-gray-100 px-1 rounded">
            PlaceOrderCommand
          </code>
          , and calls the handler which appends to an entity stream with{" "}
          <code className="bg-gray-100 px-1 rounded">expectedVersion</code>.
        </p>
      </section>

      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-lg border p-6 space-y-4"
      >
        <div>
          <label className="block text-sm font-medium mb-1">Customer</label>
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-sm"
          >
            {DEMO_CUSTOMERS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.id})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Product</label>
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-sm"
          >
            {DEMO_PRODUCTS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Quantity</label>
          <input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? "Submitting…" : "Place Order"}
        </button>
      </form>

      {message && (
        <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-md text-sm">
          {message}
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-md text-sm">
          {error}
        </div>
      )}

      <section className="bg-white rounded-lg border">
        <div className="px-6 py-4 border-b">
          <h3 className="font-semibold">
            Customer dashboard — live projection
          </h3>
          <p className="text-xs text-gray-500">
            <code className="bg-gray-100 px-1 rounded">customer-orders-list</code>{" "}
            partitioned by <code className="bg-gray-100 px-1 rounded">
              $.data.customer.id
            </code>
            . Updates pushed over WebSocket via{" "}
            <code className="bg-gray-100 px-1 rounded">subscribeToProjection</code>.
          </p>
        </div>
        {!dashboard || dashboard.orders.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-gray-400">
            No orders yet for this customer.
          </p>
        ) : (
          <ul className="divide-y">
            {dashboard.orders.map((o) => (
              <li key={o.orderId} className="px-6 py-3 text-sm flex items-center gap-4">
                <a
                  href={`/orders/${o.orderId}`}
                  className="font-mono font-medium hover:underline flex-1 min-w-0 truncate"
                >
                  {o.orderId}
                </a>
                <span className="text-gray-500">{o.summary}</span>
                <span className="text-gray-500">${o.totalAmount.toFixed(2)}</span>
                <span className="px-2 py-0.5 rounded bg-gray-100 text-xs">
                  {o.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
