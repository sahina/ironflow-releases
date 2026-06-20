"use client";

import { use, useEffect, useRef, useState } from "react";
import { ironflow } from "../../../lib/ironflow-browser";
import type { Subscription, StreamEvent } from "@ironflow/browser";
import type { OrderDetail, OrderDetailViewState } from "../../../lib/types";

// Walkthrough Step 9 / Step 10 — query the read model, stream real-time updates,
// and also show the raw event stream below for inspection.

export default function OrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = use(params);

  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const subRef = useRef<Subscription | null>(null);

  async function refresh() {
    try {
      const res = await ironflow.getProjection<OrderDetailViewState>(
        "order-detail-view",
      );
      setDetail(res.state.orders?.[orderId] ?? null);
      setNotFound(!res.state.orders?.[orderId]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("404")) setNotFound(true);
      else setError(msg);
    }
    try {
      const { events } = await ironflow.streams.read(orderId);
      setEvents(events);
    } catch {
      // stream may not exist yet for a fresh order
    }
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      await refresh();
      if (cancelled) return;
      setLoading(false);

      try {
        const sub = await ironflow.subscribeToProjection<OrderDetailViewState>(
          "order-detail-view",
          {
            onUpdate: (state) => {
              const row = state?.orders?.[orderId];
              if (row) {
                setDetail(row);
                setNotFound(false);
              }
              // also refresh the raw stream
              ironflow.streams
                .read(orderId)
                .then((r) => setEvents(r.events))
                .catch(() => {});
            },
            onError: (err) =>
              setError(err instanceof Error ? err.message : String(err)),
          },
        );
        if (cancelled) (sub as Subscription).unsubscribe();
        else subRef.current = sub as Subscription;
      } catch {
        // subscription unsupported
      }
    })();

    return () => {
      cancelled = true;
      subRef.current?.unsubscribe();
      subRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  if (loading) {
    return <p className="text-gray-500">Loading…</p>;
  }

  return (
    <div className="space-y-6">
      <header>
        <a href="/" className="text-sm text-blue-600 hover:underline">
          ← Back
        </a>
        <h2 className="text-2xl font-bold mt-1">Order {orderId}</h2>
        <p className="text-gray-500 text-sm">
          Read model: <code className="bg-gray-100 px-1 rounded">order-detail-view</code>
        </p>
      </header>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-md text-sm">
          {error}
        </div>
      )}

      {notFound && !detail && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-md text-sm">
          Projection hasn&apos;t caught up yet. This page subscribes and will
          update as soon as the worker processes the event (walkthrough Step 10).
        </div>
      )}

      {detail && (
        <section className="bg-white rounded-lg border p-6 space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-semibold">Status</span>
            <span className="px-2 py-0.5 rounded bg-gray-100 text-xs">
              {detail.status}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Customer</span>
            <span>
              {detail.customerName}{" "}
              <span className="text-gray-400">({detail.customerEmail})</span>
            </span>
          </div>
          <div className="flex justify-between">
            <span>Placed at</span>
            <span>{new Date(detail.placedAt).toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span>Total</span>
            <span>${detail.totalAmount.toFixed(2)}</span>
          </div>
          <div>
            <div className="font-semibold mb-1">Items</div>
            <ul className="divide-y border rounded">
              {detail.items.map((li) => (
                <li
                  key={li.productId}
                  className="px-3 py-2 flex justify-between"
                >
                  <span>
                    {li.name}{" "}
                    <span className="text-gray-400">× {li.qty}</span>
                  </span>
                  <span>${(li.price * li.qty).toFixed(2)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="font-semibold mb-1">Ship to</div>
            <p className="text-gray-700">
              {detail.shippingAddress.street}, {detail.shippingAddress.city}{" "}
              {detail.shippingAddress.zip}, {detail.shippingAddress.country}
            </p>
          </div>
        </section>
      )}

      <section className="bg-white rounded-lg border">
        <div className="px-6 py-4 border-b">
          <h3 className="font-semibold">Entity stream</h3>
          <p className="text-xs text-gray-500">
            Raw events from{" "}
            <code className="bg-gray-100 px-1 rounded">streams.read(&quot;{orderId}&quot;)</code>
          </p>
        </div>
        {events.length === 0 ? (
          <p className="px-6 py-6 text-sm text-gray-400">No events yet.</p>
        ) : (
          <ul className="divide-y">
            {events.map((ev) => (
              <li key={ev.id} className="px-6 py-3 text-sm">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-gray-400">
                    v{ev.entityVersion}
                  </span>
                  <span className="font-semibold">{ev.name}</span>
                  <span className="text-xs text-gray-400">
                    {new Date(ev.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <pre className="mt-1 text-xs text-gray-600 overflow-x-auto">
                  {JSON.stringify(ev.data, null, 2)}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
