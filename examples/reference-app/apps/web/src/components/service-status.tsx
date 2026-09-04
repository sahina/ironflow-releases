"use client";

import { HEALTH_LABELS } from "@/lib/service-status";
import { useSystemStatus } from "@/lib/use-system-status";

/**
 * Who is running, and how this page knows.
 *
 * The second half is the point. Four processes prove they are alive three
 * different ways, and one of them — the Python subscriber — can use neither
 * mechanism the others do. A status light with no evidence beside it would make
 * that difference look like a bug in this page.
 */
export function ServiceStatus({
  dashboardUrl,
  readModelConnected,
}: {
  dashboardUrl: string;
  readModelConnected: boolean | undefined;
}) {
  const rows = useSystemStatus(readModelConnected);

  return (
    <section aria-labelledby="service-status">
      <h2 id="service-status">Right now</h2>
      <ul aria-labelledby="service-status" className="status">
        {rows.map((row) => (
          <li key={row.key} aria-label={row.name} data-health={row.health}>
            <span className="status-name">
              {row.name} <small>{row.language}</small>
            </span>
            <span className="status-health">{HEALTH_LABELS[row.health]}</span>
            <span className="status-role">{row.role}</span>
            <small className="status-evidence">{row.evidence}</small>
          </li>
        ))}
      </ul>
      <p>
        Runs, steps, streams, projections and audit detail live in the{" "}
        <a href={dashboardUrl} target="_blank" rel="noreferrer">
          Ironflow dashboard
        </a>
        . This application deliberately does not rebuild them.
      </p>
    </section>
  );
}
