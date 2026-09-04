"use client";

import { useState } from "react";

import { dashboardRunUrl, dashboardStreamUrl } from "@/lib/dashboard-links";
import { producerLabel, type ProjectedOrder } from "@/lib/orders";
import { useRunsForOrder } from "@/lib/use-run-links";

/**
 * The domain facts behind one order, in order, with the service and language
 * that produced each. Collapsed by default: it is the explanation, not the
 * headline, and the payloads stay in the dashboard rather than being rebuilt
 * here.
 *
 * Below the facts: the entity streams, and the runs this order caused. Runs are
 * listed per order rather than per fact — the projection records event ids from
 * a different id space than the one runs are keyed by, and a run produces
 * several facts anyway. They are fetched only when the timeline is opened.
 */
export function Timeline({
  order,
  dashboardUrl,
  runId,
}: {
  order: ProjectedOrder;
  dashboardUrl: string;
  /**
   * The run this browser's own `place.order` started, when it started one. It
   * comes back from the command, so it needs no lookup and is available before
   * the fact it produced has reached the read model.
   */
  runId?: string;
}) {
  const [opened, setOpened] = useState(false);
  const runs = useRunsForOrder(order.orderId, opened);

  return (
    <details onToggle={(event) => setOpened(event.currentTarget.open || opened)}>
      <summary>Events ({order.timeline.length})</summary>
      <ul>
        {order.timeline.map((entry, index) => (
          <li key={`${entry.event}-${index}`} aria-label={entry.event}>
            <span>{entry.event}</span>
            <span>{entry.producer}</span>
            <span>{producerLabel(entry)}</span>
            <time dateTime={entry.at}>{entry.at}</time>
          </li>
        ))}
      </ul>

      <p className="timeline-links">
        <a href={dashboardStreamUrl(dashboardUrl, order.orderId, "order")} target="_blank" rel="noreferrer">
          Open the order stream
        </a>
        {/* Only once a payment fact exists: Payments creates the stream when it
            writes its first fact, and a link to a stream that is not there yet
            is a link to an error page. */}
        {order.authorizationId && (
          <a
            href={dashboardStreamUrl(dashboardUrl, order.orderId, "payment")}
            target="_blank"
            rel="noreferrer"
          >
            Open the payment stream
          </a>
        )}
        {runId && (
          <a href={dashboardRunUrl(dashboardUrl, runId)} target="_blank" rel="noreferrer">
            Open the run that placed it
          </a>
        )}
      </p>

      {runs.length > 0 && (
        <ul aria-label="Runs for this order">
          {runs.map((run) => (
            <li key={run.id}>
              <a href={dashboardRunUrl(dashboardUrl, run.id)} target="_blank" rel="noreferrer">
                Open the {run.functionId} run <code>{run.id.slice(0, 8)}</code>
              </a>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
