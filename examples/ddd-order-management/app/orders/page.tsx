"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ironflow } from "../../lib/ironflow";
import type { Run, Subscription } from "@ironflow/browser";

interface DashboardState {
  totalOrders: number;
  totalRevenue: number;
  byStatus: { placed: number; confirmed: number; shipped: number; cancelled: number };
}

export default function OrderListPage() {
  const [dashboard, setDashboard] = useState<DashboardState | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const subscriptionRef = useRef<Subscription | null>(null);

  // Fetch runs (no projection subscription equivalent for runs)
  const fetchRuns = useCallback(async () => {
    try {
      const result = await ironflow.listRuns({ functionId: "place-order", limit: 50 });
      setRuns(result.runs);
    } catch {
      // Runs polling is best-effort
    }
  }, []);

  useEffect(() => {
    // Initial load: fetch projection state + runs in parallel
    async function init() {
      try {
        const [projResult, runsResult] = await Promise.allSettled([
          ironflow.getProjection<DashboardState>("order-dashboard"),
          ironflow.listRuns({ functionId: "place-order", limit: 50 }),
        ]);

        if (projResult.status === "fulfilled") {
          setDashboard(projResult.value.state);
        }
        if (runsResult.status === "fulfilled") {
          setRuns(runsResult.value.runs);
        }
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch data");
      } finally {
        setLoading(false);
      }

      // Subscribe to real-time projection updates (replaces 3s polling)
      try {
        const sub = await ironflow.subscribeToProjection<DashboardState>(
          "order-dashboard",
          {
            onUpdate: (state) => {
              if (state) setDashboard(state);
              // Refresh runs when projection updates (new order processed)
              fetchRuns();
            },
            onError: (err) => setError(err instanceof Error ? err.message : String(err)),
          },
        );
        subscriptionRef.current = sub as Subscription;
      } catch {
        // Fall back to polling if subscriptions unavailable
        const interval = setInterval(async () => {
          try {
            const result = await ironflow.getProjection<DashboardState>("order-dashboard");
            setDashboard(result.state);
          } catch { /* ignore */ }
          fetchRuns();
        }, 3000);
        return () => clearInterval(interval);
      }
    }

    init();

    return () => {
      subscriptionRef.current?.unsubscribe();
    };
  }, [fetchRuns]);

  const statusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "text-green-700 bg-green-50";
      case "running":
        return "text-blue-700 bg-blue-50";
      case "failed":
        return "text-red-700 bg-red-50";
      case "pending":
        return "text-yellow-700 bg-yellow-50";
      default:
        return "text-gray-700 bg-gray-50";
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-gray-500">Loading orders...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Order List</h2>
        <p className="text-gray-500 text-sm mt-1">
          CQRS read model from the <code className="bg-gray-100 px-1 rounded">order-dashboard</code> projection
          + recent runs. Updates in real-time via projection subscription.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-md text-sm">
          {error}
        </div>
      )}

      {/* Stats Cards */}
      {dashboard && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg border p-4 text-center">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Total Orders</p>
            <p className="text-3xl font-bold mt-1">{dashboard.totalOrders ?? 0}</p>
          </div>
          <div className="bg-white rounded-lg border p-4 text-center">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Revenue</p>
            <p className="text-3xl font-bold mt-1">${(dashboard.totalRevenue ?? 0).toFixed(2)}</p>
          </div>
          <div className="bg-white rounded-lg border p-4 text-center">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Shipped</p>
            <p className="text-3xl font-bold mt-1 text-green-600">{dashboard.byStatus?.shipped ?? 0}</p>
          </div>
          <div className="bg-white rounded-lg border p-4 text-center">
            <p className="text-xs text-gray-500 uppercase tracking-wide">In Progress</p>
            <p className="text-3xl font-bold mt-1 text-blue-600">
              {(dashboard.byStatus?.placed ?? 0) + (dashboard.byStatus?.confirmed ?? 0)}
            </p>
          </div>
        </div>
      )}

      {/* Run List */}
      <div className="bg-white rounded-lg border">
        <div className="px-6 py-4 border-b">
          <h3 className="font-semibold">Recent Runs</h3>
          <p className="text-xs text-gray-500">
            Runs for <code className="bg-gray-100 px-1 rounded">place-order</code> function
          </p>
        </div>
        {runs.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-gray-400">
            No orders yet. Go to Place Order to create one.
          </p>
        ) : (
          <div className="divide-y">
            {runs.map((run) => {
              // Extract orderId from run input if available
              const input = run.input as { orderId?: string } | undefined;
              const runOrderId = input?.orderId;

              const content = (
                <>
                  <span className="font-mono text-sm font-medium flex-1 truncate">
                    {runOrderId ?? run.id}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium ${statusColor(run.status)}`}
                  >
                    {run.status}
                  </span>
                  <span className="text-xs text-gray-400">
                    {new Date(run.createdAt).toLocaleTimeString()}
                  </span>
                </>
              );

              return runOrderId ? (
                <a
                  key={run.id}
                  href={`/orders/${runOrderId}`}
                  className="px-6 py-3 flex items-center gap-4 hover:bg-gray-50 transition-colors"
                >
                  {content}
                </a>
              ) : (
                <div
                  key={run.id}
                  className="px-6 py-3 flex items-center gap-4 text-gray-500"
                >
                  {content}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
