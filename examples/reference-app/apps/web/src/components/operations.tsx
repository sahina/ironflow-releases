"use client";

import { useState } from "react";

import { useIronflow } from "@/components/ironflow-provider";
import { Timeline } from "@/components/timeline";
import { formatCents } from "@/lib/contracts";
import {
  awaitingPresenterRelease,
  inPayment,
  type PaymentStage,
  paymentStage,
  pendingApprovals,
} from "@/lib/orders";
import { useOrders } from "@/lib/use-orders";
import { useWorkerPresence } from "@/lib/use-worker-presence";

// The example has no users and no authentication — approval is an operator
// action, and this is who the demo records as the operator.
const OPERATOR = "operations@example.com";

// How far the attempt got. Not a fifth order state: the customer still sees
// four, and these are what the operator watches inside `processing_payment`.
const STAGE_LABELS: Record<PaymentStage, string> = {
  not_started: "Not started",
  authorized: "Authorized",
  captured: "Captured",
  declined: "Declined",
};

export function Operations({ session, dashboardUrl }: { session: string; dashboardUrl: string }) {
  const ironflow = useIronflow();
  const { orders, error } = useOrders(session);
  const queue = pendingApprovals(orders);
  const payments = inPayment(orders);
  const workerPresent = useWorkerPresence();
  // Per order, not one flag for the view: acting on one order must not disable
  // the rest of the queue.
  const [busy, setBusy] = useState<string[]>([]);
  // A command that the engine refused. Distinct from `error`, which reports
  // that the read model is unreachable.
  const [failure, setFailure] = useState<string | undefined>(undefined);

  const send = async (key: string, event: string, data: Record<string, unknown>, orderId: string) => {
    if (busy.includes(key)) return;
    setBusy((keys) => [...keys, key]);
    try {
      await ironflow.emit(event, data, {
        correlationId: orderId,
        causationId: orderId,
        producer: "web",
        demoSessionId: session,
      });
      setFailure(undefined);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause));
    } finally {
      // Cleared on both paths. Holding the key after a success would be the
      // stricter double-click guard, but the domain already refuses a second
      // approval and a second release matches no waiting run — while a command
      // that failed silently and left its button dead for the rest of the demo
      // has no recourse at all. Releasing it makes a lost command retryable.
      setBusy((keys) => keys.filter((held) => held !== key));
    }
  };

  const approve = (orderId: string) =>
    send(`approve:${orderId}`, "approve.order", { orderId, approvedBy: OPERATOR }, orderId);

  // Demo scaffolding, not domain. It releases the durable wait the payment
  // worker parks on in the crash scenario, and nothing else reacts to it.
  const continuePayment = (orderId: string) =>
    send(`continue:${orderId}`, "demo.payment.continue", { orderId }, orderId);

  return (
    <section aria-label="Operations">
      <h1>Operations</h1>
      {error && <p role="alert">Cannot reach Ironflow — {error}</p>}
      {failure && <p role="alert">That command did not reach Ironflow — {failure}. Try it again.</p>}

      {workerPresent !== undefined && (
        <p data-testid="payment-worker">
          <span>{workerPresent ? "Payment worker running" : "Payment worker gone"}</span>
          {!workerPresent && <small> The supervisor restarts it automatically — no order is lost.</small>}
        </p>
      )}

      <h2 id="approval-queue">Waiting for approval</h2>
      <ul aria-labelledby="approval-queue">
        {queue.map((order) => (
          <li key={order.orderId}>
            <span>{order.customerEmail}</span>
            <span>{formatCents(order.totalCents)}</span>
            <button
              type="button"
              onClick={() => void approve(order.orderId)}
              disabled={busy.includes(`approve:${order.orderId}`)}
            >
              Approve
            </button>
            <Timeline order={order} dashboardUrl={dashboardUrl} />
          </li>
        ))}
      </ul>
      {queue.length === 0 && <p>No orders are waiting for approval.</p>}

      <h2 id="payment-queue">Payments</h2>
      <ul aria-labelledby="payment-queue">
        {payments.map((order) => {
          const parked = awaitingPresenterRelease(order);
          return (
            <li key={order.orderId}>
              <span>{order.customerEmail}</span>
              <span>{formatCents(order.totalCents)}</span>
              <span data-testid="payment-stage">{STAGE_LABELS[paymentStage(order)]}</span>
              {(order.failureReason ?? order.declineReason) && (
                <span>Reason: {order.failureReason ?? order.declineReason}</span>
              )}
              {parked && <CrashGuidance />}
              {parked && (
                <button
                  type="button"
                  onClick={() => void continuePayment(order.orderId)}
                  disabled={busy.includes(`continue:${order.orderId}`)}
                >
                  Continue payment
                </button>
              )}
              <Timeline order={order} dashboardUrl={dashboardUrl} />
            </li>
          );
        })}
      </ul>
      {payments.length === 0 && <p>No payments have started.</p>}
    </section>
  );
}

/**
 * What the presenter does next, at the moment it is true.
 *
 * It appears only while an order is parked between the hold and the capture,
 * because that is the only point where killing the worker demonstrates durable
 * replay rather than a stalled run: a parked run holds no worker claim.
 */
function CrashGuidance() {
  return (
    <p>
      The card is held and this run is parked. Run <code>make reference-app-crash-payment</code> in a second
      terminal, watch the worker leave and come back, then continue. The gateway is never asked to authorize
      twice.
    </p>
  );
}
