"use client";

import { useState, useEffect, useCallback, useRef, use } from "react";
import { ironflow } from "../../../lib/ironflow";
import type { StreamEvent, Subscription } from "@ironflow/browser";
import { STREAM_EVENTS } from "../../../events";

interface OrderSummaryState {
  orderId: string;
  customerId: string;
  items: Array<{ sku: string; qty: number; price: number }>;
  total: number;
  status: string;
  transactionId: string | null;
  trackingNumber: string | null;
}

const eventIcon = (name: string) => {
  switch (name) {
    case STREAM_EVENTS.OrderPlaced:
      return "📦";
    case STREAM_EVENTS.OrderConfirmed:
      return "✅";
    case STREAM_EVENTS.OrderShipped:
      return "🚚";
    case STREAM_EVENTS.OrderCancelled:
      return "❌";
    default:
      return "📝";
  }
};

const statusBadge = (status: string) => {
  switch (status) {
    case "placed":
      return "text-yellow-700 bg-yellow-50 border-yellow-200";
    case "confirmed":
      return "text-blue-700 bg-blue-50 border-blue-200";
    case "shipped":
      return "text-green-700 bg-green-50 border-green-200";
    case "cancelled":
      return "text-red-700 bg-red-50 border-red-200";
    default:
      return "text-gray-700 bg-gray-50 border-gray-200";
  }
};

export default function OrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = use(params);
  const streamId = `order-${orderId}`;

  const [summary, setSummary] = useState<OrderSummaryState | null>(null);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectionError, setProjectionError] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const subscriptionRef = useRef<Subscription | null>(null);

  // Fetch entity stream events (no subscription equivalent for streams)
  const fetchStream = useCallback(async () => {
    try {
      const result = await ironflow.streams.read(streamId);
      setEvents(result.events);
      setStreamError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("404") && !msg.includes("not found")) {
        setStreamError(msg);
      }
    }
  }, [streamId]);

  useEffect(() => {
    async function init() {
      // Initial load: fetch projection state + entity stream in parallel
      const [projResult, streamResult] = await Promise.allSettled([
        ironflow.getProjection<OrderSummaryState>("order-summary", {
          partition: orderId,
        }),
        ironflow.streams.read(streamId),
      ]);

      if (projResult.status === "fulfilled") {
        setSummary(projResult.value.state);
        setProjectionError(null);
      } else {
        const msg = projResult.reason instanceof Error ? projResult.reason.message : String(projResult.reason);
        if (!msg.includes("404")) {
          setProjectionError(msg);
        }
      }

      if (streamResult.status === "fulfilled") {
        setEvents(streamResult.value.events);
        setStreamError(null);
      } else {
        const msg = streamResult.reason instanceof Error ? streamResult.reason.message : String(streamResult.reason);
        if (!msg.includes("404") && !msg.includes("not found")) {
          setStreamError(msg);
        }
      }

      setLoading(false);

      // Subscribe to real-time projection updates for this partition
      try {
        const sub = await ironflow.subscribeToProjection<OrderSummaryState>(
          "order-summary",
          {
            onUpdate: (state) => {
              if (state) setSummary(state);
              setProjectionError(null);
              // Refresh stream events when projection updates
              fetchStream();
            },
            onError: (err) => setProjectionError(err instanceof Error ? err.message : String(err)),
          },
          { partition: orderId },
        );
        subscriptionRef.current = sub as Subscription;
      } catch {
        // Fall back to polling if subscriptions unavailable
        const interval = setInterval(async () => {
          try {
            const result = await ironflow.getProjection<OrderSummaryState>("order-summary", {
              partition: orderId,
            });
            setSummary(result.state);
          } catch { /* ignore */ }
          fetchStream();
        }, 3000);
        return () => clearInterval(interval);
      }
    }

    init();

    return () => {
      subscriptionRef.current?.unsubscribe();
    };
  }, [orderId, streamId, fetchStream]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-gray-500">Loading order details...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <a href="/orders" className="text-blue-600 hover:underline text-sm">
          &larr; Orders
        </a>
        <h2 className="text-2xl font-bold">Order {orderId}</h2>
        {summary && (
          <span
            className={`px-2 py-0.5 rounded border text-xs font-medium ${statusBadge(summary.status)}`}
          >
            {summary.status}
          </span>
        )}
      </div>

      {/* Projection Read Model */}
      <div className="bg-white rounded-lg border">
        <div className="px-6 py-4 border-b">
          <h3 className="font-semibold">Read Model (CQRS)</h3>
          <p className="text-xs text-gray-500">
            From <code className="bg-gray-100 px-1 rounded">order-summary</code> projection,
            partition: <code className="bg-gray-100 px-1 rounded">{orderId}</code>
          </p>
        </div>
        {projectionError && (
          <div className="m-4 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-md text-sm">
            {projectionError}
          </div>
        )}
        {summary ? (
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide">Customer</p>
                <p className="font-mono text-sm mt-1">{summary.customerId}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide">Total</p>
                <p className="text-lg font-bold mt-1">${(summary.total ?? 0).toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide">Transaction</p>
                <p className="font-mono text-sm mt-1">{summary.transactionId ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide">Tracking</p>
                <p className="font-mono text-sm mt-1">{summary.trackingNumber ?? "—"}</p>
              </div>
            </div>

            {summary.items?.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Items</p>
                <div className="border rounded-md divide-y text-sm">
                  {summary.items.map((item, i) => (
                    <div key={i} className="px-4 py-2 flex justify-between">
                      <span className="font-mono">{item.sku}</span>
                      <span>
                        {item.qty} x ${(item.price ?? 0).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          !projectionError && (
            <p className="px-6 py-8 text-center text-sm text-gray-400">
              No projection state yet. Is the worker running?
            </p>
          )
        )}
      </div>

      {/* Entity Stream Timeline */}
      <div className="bg-white rounded-lg border">
        <div className="px-6 py-4 border-b">
          <h3 className="font-semibold">Entity Stream Timeline</h3>
          <p className="text-xs text-gray-500">
            Domain events from <code className="bg-gray-100 px-1 rounded">{streamId}</code>{" "}
            ({events.length} event{events.length !== 1 ? "s" : ""})
          </p>
        </div>
        {streamError && (
          <div className="m-4 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-md text-sm">
            {streamError}
          </div>
        )}
        {events.length === 0 ? (
          !streamError && (
            <p className="px-6 py-8 text-center text-sm text-gray-400">
              No events in this stream yet.
            </p>
          )
        ) : (
          <div className="divide-y">
            {events.map((evt) => (
              <div key={evt.id} className="px-6 py-4">
                <div className="flex items-center gap-3">
                  <span className="text-lg">{eventIcon(evt.name)}</span>
                  <div className="flex-1">
                    <p className="font-medium text-sm">{evt.name}</p>
                    <p className="text-xs text-gray-400">
                      v{evt.entityVersion} · {new Date(evt.timestamp).toLocaleString()}
                    </p>
                  </div>
                </div>
                <pre className="mt-2 bg-gray-50 rounded p-3 text-xs overflow-x-auto">
                  {JSON.stringify(evt.data, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
