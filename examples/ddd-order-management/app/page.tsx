"use client";

import { useState, useEffect } from "react";
import { ironflow } from "../lib/ironflow";
import type { Subscription, SubscriptionEvent } from "@ironflow/browser";
import { EVENTS } from "../events";

interface SagaEvent {
  id: string;
  topic: string;
  functionId?: string;
  status?: string;
  timestamp: Date;
}

export default function PlaceOrderPage() {
  const [orderId, setOrderId] = useState(() => `ORD-${Date.now().toString(36)}`);
  const [total, setTotal] = useState("49.99");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [sagaEvents, setSagaEvents] = useState<SagaEvent[]>([]);

  useEffect(() => {
    let cancelled = false;
    let sub: Subscription | null = null;

    async function setup() {
      try {
        await ironflow.connect();
        const s = await ironflow.subscribe("system.run.>", {
          onEvent: (event: SubscriptionEvent) => {
            if (cancelled) return;
            const data = event.data as { functionId?: string; status?: string; id?: string };
            setSagaEvents((prev) => [
              {
                id: crypto.randomUUID(),
                topic: event.topic,
                functionId: data.functionId,
                status: data.status,
                timestamp: new Date(),
              },
              ...prev,
            ].slice(0, 50));
          },
          onError: (err) => {
            if (!err.message?.includes("canceled") && !err.message?.includes("aborted")) {
              console.error("Subscription error:", err.message);
            }
          },
        });
        if (cancelled) {
          (s as Subscription).unsubscribe();
        } else {
          sub = s as Subscription;
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to subscribe:", err);
        }
      }
    }

    setup();

    return () => {
      cancelled = true;
      sub?.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);

    try {
      const result = await ironflow.emit(EVENTS.CreateOrder, {
        orderId,
        customerId: "customer-1",
        items: [{ sku: "WIDGET-1", qty: 2, price: Number(total) / 2 }],
        total: Number(total),
      });
      setSuccess(`Order submitted! Event ID: ${result.eventId}, Runs: ${result.runIds.join(", ")}`);
      // Generate new orderId for next order
      setOrderId(`ORD-${Date.now().toString(36)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to place order");
    } finally {
      setSubmitting(false);
    }
  };

  const statusColor = (status?: string) => {
    switch (status) {
      case "completed":
        return "text-green-700 bg-green-50 border-green-200";
      case "running":
        return "text-blue-700 bg-blue-50 border-blue-200";
      case "failed":
        return "text-red-700 bg-red-50 border-red-200";
      default:
        return "text-gray-700 bg-gray-50 border-gray-200";
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Place Order</h2>
        <p className="text-gray-500 text-sm mt-1">
          Emit a <code className="bg-gray-100 px-1 rounded">create.order</code> command.
          The worker validates the aggregate, appends <code className="bg-gray-100 px-1 rounded">order.placed</code> to
          the entity stream, then the saga confirms payment and ships.
        </p>
      </div>

      {/* Order Form */}
      <form onSubmit={handleSubmit} className="bg-white rounded-lg border p-6 space-y-4">
        <div>
          <label htmlFor="orderId" className="block text-sm font-medium mb-1">
            Order ID
          </label>
          <input
            id="orderId"
            type="text"
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-sm"
            required
          />
        </div>
        <div>
          <label htmlFor="total" className="block text-sm font-medium mb-1">
            Total ($)
          </label>
          <input
            id="total"
            type="number"
            step="0.01"
            min="0.01"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-sm"
            required
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? "Submitting..." : "Place Order"}
        </button>
      </form>

      {/* Success / Error */}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-md text-sm">
          {success}
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-md text-sm">
          {error}
        </div>
      )}

      {/* Live Saga Events */}
      <div className="bg-white rounded-lg border">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div>
            <h3 className="font-semibold">Live Saga Events</h3>
            <p className="text-xs text-gray-500">
              Real-time subscription to <code className="bg-gray-100 px-1 rounded">system.run.&gt;</code>
            </p>
          </div>
          {sagaEvents.length > 0 && (
            <button
              onClick={() => setSagaEvents([])}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Clear
            </button>
          )}
        </div>
        <div className="divide-y max-h-96 overflow-y-auto">
          {sagaEvents.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-gray-400">
              No events yet. Place an order to see the saga execute in real time.
            </p>
          ) : (
            sagaEvents.map((evt) => (
              <div key={evt.id} className="px-6 py-3 flex items-center gap-3 text-sm">
                <span
                  className={`px-2 py-0.5 rounded border text-xs font-medium ${statusColor(evt.status)}`}
                >
                  {evt.status ?? "event"}
                </span>
                <span className="font-mono text-gray-600 truncate flex-1">{evt.functionId ?? "—"}</span>
                <span className="text-xs text-gray-400">
                  {evt.timestamp.toLocaleTimeString()}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
