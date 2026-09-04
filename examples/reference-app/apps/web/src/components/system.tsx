"use client";

import { CrashResumeSequence } from "@/components/diagrams/crash-resume-sequence";
import { HappyPathSequence } from "@/components/diagrams/happy-path-sequence";
import { SystemMap } from "@/components/diagrams/system-map";
import { ServiceStatus } from "@/components/service-status";
import { SERVICES } from "@/lib/service-status";
import { sourceUrl } from "@/lib/source-links";

/**
 * What the system is, who is running, and where the code is.
 *
 * It explains the architecture rather than instrumenting it: runs, steps,
 * streams and projections stay in the Ironflow dashboard, which this page links
 * to instead of rebuilding.
 */
export function System({
  dashboardUrl,
  readModelConnected,
}: {
  dashboardUrl: string;
  readModelConnected: boolean | undefined;
}) {
  return (
    <section aria-label="System">
      <h1>The system</h1>
      <p>
        Four processes in three languages share one local Ironflow server. They never call each
        other over business HTTP: every message is an Ironflow command, entity event, projection
        update or Pub/Sub message.
      </p>

      <SystemMap />

      <ServiceStatus dashboardUrl={dashboardUrl} readModelConnected={readModelConnected} />

      <h2 id="flows">The two sequences</h2>
      <p>
        The ordinary order, and the one an audience remembers. A permanent decline is the happy
        path stopping after the authorization is refused, so it gets no drawing of its own.
      </p>
      <HappyPathSequence />
      <CrashResumeSequence />

      <h2 id="source">The source</h2>
      <ul aria-labelledby="source" className="source">
        {SERVICES.map((service) => (
          <li key={service.key}>
            <span>
              {service.name} <small>{service.language}</small>
            </span>
            <span>{service.role}</span>
            <a href={sourceUrl(service.source)} target="_blank" rel="noreferrer">
              {service.source === "" ? "the Ironflow engine" : service.source}
            </a>
          </li>
        ))}
      </ul>
      <p>
        The shared wire contract — one JSON Schema per message, the catalog and the fixtures every
        language validates — is in{" "}
        <a href={sourceUrl("contracts")} target="_blank" rel="noreferrer">
          contracts
        </a>
        , and the domain vocabulary is in{" "}
        <a href={sourceUrl("CONTEXT-MAP.md")} target="_blank" rel="noreferrer">
          CONTEXT-MAP.md
        </a>
        .
      </p>
    </section>
  );
}
