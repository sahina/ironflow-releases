"use client";

import { useEffect, useRef, useState } from "react";
import { ironflow } from "@ironflow/browser";

const SERVER_URL =
  process.env["NEXT_PUBLIC_IRONFLOW_URL"] ?? "http://localhost:9123";
const AGENT_ID = process.env["NEXT_PUBLIC_AGENT_ID"] ?? "doc-processor";

type Status = "idle" | "invoking" | "running" | "completed" | "failed" | "cancelled";

interface StepRow {
  stepId: string;
  type: string;
  topic: string;
}

interface DocState {
  docId: string;
  status: "ocr" | "classified" | "published";
  category?: string;
  processedAt?: string;
}

type DocMemory = Record<string, DocState>;

const MEMORY_PROJECTION = "doc-processor-memory";

export default function Home() {
  const [docId, setDocId] = useState("doc-demo-1");
  const [imageUrl, setImageUrl] = useState(
    "https://example.com/invoice.png"
  );
  const [status, setStatus] = useState<Status>("idle");
  const [runId, setRunId] = useState<string | null>(null);
  const [output, setOutput] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [memory, setMemory] = useState<DocMemory | null>(null);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const idemRef = useRef<string>("");
  const currentRunIdRef = useRef<string | null>(null);

  /**
   * Read the agent's memory projection. Eventual consistency: poll
   * briefly because the projection cursor can lag the run.completed
   * event by a few ms. Honors `signal` so an unmount/cancel stops the
   * poll loop and any in-flight read.
   */
  async function loadMemoryFor(
    targetDocId: string,
    signal: AbortSignal
  ): Promise<void> {
    setMemoryError(null);
    const deadline = Date.now() + 5_000;
    try {
      while (Date.now() < deadline) {
        if (signal.aborted) return;
        const result = await ironflow.agents.readMemory<DocMemory>(
          MEMORY_PROJECTION,
          { signal }
        );
        if (result.state[targetDocId]) {
          setMemory(result.state);
          return;
        }
        await new Promise<void>((res) => {
          const t = setTimeout(res, 100);
          signal.addEventListener("abort", () => {
            clearTimeout(t);
            res();
          }, { once: true });
        });
      }
      if (signal.aborted) return;
      // Final read so the user sees whatever state did land.
      const final = await ironflow.agents.readMemory<DocMemory>(
        MEMORY_PROJECTION,
        { signal }
      );
      setMemory(final.state);
    } catch (err) {
      const e = err as { name?: string; message?: string };
      // Aborts during unmount are expected — silent.
      if (e.name === "AbortError") return;
      setMemoryError(e.message ?? "failed to read memory");
    }
  }

  useEffect(() => {
    ironflow.configure({
      serverUrl: SERVER_URL,
      transport: "connectrpc",
      environment: "default",
    });
    void ironflow.connect();

    // Tab close / unmount fires abort, which causes ironflow.agents.invoke
    // to call cancelRun(runId) on the server. Without this, an in-flight
    // agent keeps running after the user navigates away.
    const onUnload = () => abortRef.current?.abort();
    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("pagehide", onUnload);

    return () => {
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("pagehide", onUnload);
      abortRef.current?.abort();
      ironflow.disconnect();
    };
  }, []);

  async function run() {
    if (status === "invoking" || status === "running") return;

    // Reset state.
    setStatus("invoking");
    setRunId(null);
    setOutput(null);
    setError(null);
    setSteps([]);
    setMemory(null);
    setMemoryError(null);

    // Stable idempotency key per click — protects against double-fire.
    idemRef.current = `web-${docId}-${Date.now()}`;
    const ac = new AbortController();
    abortRef.current = ac;

    let watchSub: { unsubscribe(): void } | null = null;

    try {
      const result = await ironflow.agents.invoke<{
        docId: string;
        category: string;
      }>(
        AGENT_ID,
        { docId, imageUrl },
        {
          idempotencyKey: idemRef.current,
          signal: ac.signal,
          timeoutMs: 60_000,
          onRunStarted: async (rid) => {
            currentRunIdRef.current = rid;
            setRunId(rid);
            setStatus("running");
            // Attach a parallel subscription for live progress + step events.
            // Replay (default 1000) inside agents.subscribe covers any
            // events emitted between Trigger return and this attach.
            try {
              watchSub = await ironflow.agents.subscribe(rid, {
                onStep: (e) => {
                  // Drop late events from prior runs.
                  if (currentRunIdRef.current !== rid) return;
                  setSteps((prev) => {
                    const exists = prev.some(
                      (s) => s.stepId === e.stepId && s.type === e.type
                    );
                    return exists
                      ? prev
                      : [
                          ...prev,
                          { stepId: e.stepId, type: e.type, topic: e.topic },
                        ];
                  });
                },
              });
            } catch {
              /* progress is best-effort; invoke result still arrives */
            }
          },
        }
      );

      setStatus("completed");
      setOutput(result.output);
      // Pull the agent's memory projection so the UI shows what was
      // actually persisted (status, category) rather than just the
      // run's final output payload. Reuses the run's AbortController
      // so an unmount/tab-close also stops the memory poll.
      void loadMemoryFor(docId, ac.signal);
    } catch (err) {
      const e = err as { name?: string; message?: string };
      if (e.name === "RunFailedError") {
        setStatus("failed");
        setError(e.message ?? "Run failed");
      } else if (e.name === "RunCancelledError") {
        setStatus("cancelled");
        setError("Run was cancelled");
      } else if (e.name === "AbortError") {
        setStatus("cancelled");
        setError("Aborted");
      } else {
        setStatus("failed");
        setError(e.message ?? String(err));
      }
    } finally {
      // Clean up the parallel progress subscription. Invoke has already
      // settled by the time this runs, so step events have been delivered.
      watchSub?.unsubscribe();
    }
  }

  function cancel() {
    abortRef.current?.abort();
  }

  return (
    <main style={{ maxWidth: 720, margin: "60px auto", padding: 24 }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Doc Processor — Ironflow Demo</h1>
      <p style={{ color: "#9aa4b1", marginTop: 0 }}>
        Browser-driven <code>{AGENT_ID}</code> agent via{" "}
        <code>ironflow.agents.invoke()</code>,{" "}
        <code>agents.subscribe()</code>, and <code>agents.readMemory()</code>.
        See <code>sdk/js/browser/src/agents/spec.md</code> for the contract.
      </p>

      <div style={{ display: "grid", gap: 12, margin: "24px 0" }}>
        <label>
          <div style={{ fontSize: 12, color: "#9aa4b1" }}>docId</div>
          <input
            value={docId}
            onChange={(e) => setDocId(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label>
          <div style={{ fontSize: 12, color: "#9aa4b1" }}>imageUrl</div>
          <input
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            style={inputStyle}
          />
        </label>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={run}
          disabled={status === "invoking" || status === "running"}
          style={btnPrimary}
        >
          {status === "invoking"
            ? "Starting…"
            : status === "running"
            ? "Running…"
            : "Run agent"}
        </button>
        <button
          onClick={cancel}
          disabled={status !== "running" && status !== "invoking"}
          style={btnSecondary}
        >
          Cancel
        </button>
      </div>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 18 }}>Status</h2>
        <p>
          <span style={statusPill(status)}>{status.toUpperCase()}</span>
          {runId && (
            <span style={{ color: "#9aa4b1", marginLeft: 12 }}>
              runId: <code>{runId}</code>
            </span>
          )}
        </p>
      </section>

      {steps.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 18 }}>Steps</h2>
          <ul style={{ paddingLeft: 18 }}>
            {steps.map((s, i) => (
              <li key={i} style={{ color: "#cdd5df" }}>
                <code>{s.stepId}</code> — {s.type}
              </li>
            ))}
          </ul>
        </section>
      )}

      {output !== null && (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 18 }}>Output</h2>
          <pre style={preStyle}>{JSON.stringify(output, null, 2)}</pre>
        </section>
      )}

      {memory && (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 18 }}>
            Memory{" "}
            <span style={{ fontSize: 12, color: "#9aa4b1", fontWeight: 400 }}>
              (projection: <code>{MEMORY_PROJECTION}</code> — read via{" "}
              <code>agents.readMemory</code>)
            </span>
          </h2>
          {Object.keys(memory).length === 0 ? (
            <p style={{ color: "#9aa4b1" }}>(empty)</p>
          ) : (
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 13,
              }}
            >
              <thead>
                <tr style={{ color: "#9aa4b1" }}>
                  <th style={thStyle}>docId</th>
                  <th style={thStyle}>status</th>
                  <th style={thStyle}>category</th>
                  <th style={thStyle}>processedAt</th>
                </tr>
              </thead>
              <tbody>
                {Object.values(memory).map((d) => (
                  <tr
                    key={d.docId}
                    style={{
                      background: d.docId === docId ? "#1a2030" : "transparent",
                    }}
                  >
                    <td style={tdStyle}>
                      <code>{d.docId}</code>
                    </td>
                    <td style={tdStyle}>{d.status}</td>
                    <td style={tdStyle}>{d.category ?? "—"}</td>
                    <td style={tdStyle}>{d.processedAt ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {memoryError && (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 18, color: "#ff8a8a" }}>Memory error</h2>
          <pre style={preStyle}>{memoryError}</pre>
        </section>
      )}

      {error && (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 18, color: "#ff8a8a" }}>Error</h2>
          <pre style={preStyle}>{error}</pre>
        </section>
      )}
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  background: "#1a2030",
  color: "#e6e8eb",
  border: "1px solid #2a3145",
  borderRadius: 6,
  fontSize: 14,
};

const btnPrimary: React.CSSProperties = {
  padding: "10px 18px",
  background: "#3b82f6",
  color: "white",
  border: "none",
  borderRadius: 6,
  fontSize: 14,
  cursor: "pointer",
};

const btnSecondary: React.CSSProperties = {
  ...btnPrimary,
  background: "#374151",
};

const preStyle: React.CSSProperties = {
  background: "#0f1422",
  border: "1px solid #2a3145",
  borderRadius: 6,
  padding: 12,
  fontSize: 12,
  overflow: "auto",
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  borderBottom: "1px solid #2a3145",
  fontWeight: 600,
};

const tdStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderBottom: "1px solid #1a2030",
  color: "#cdd5df",
};

function statusPill(s: Status): React.CSSProperties {
  const color =
    s === "completed"
      ? "#10b981"
      : s === "failed"
      ? "#ef4444"
      : s === "cancelled"
      ? "#f59e0b"
      : s === "running" || s === "invoking"
      ? "#3b82f6"
      : "#6b7280";
  return {
    display: "inline-block",
    background: color,
    color: "white",
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
  };
}
