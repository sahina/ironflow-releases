// @vitest-environment node
/**
 * Live test: the page's agents.invoke + agents.readMemory calls against a real
 * server and a running doc-processor worker (#2919). Skips unless
 * IRONFLOW_INTEGRATION=1; `make test-agent-example-live` sets it up.
 * The browser SDK runs under Node here, not in a browser.
 */
import { ironflow } from "@ironflow/browser";
import { describe, expect, it } from "vitest";

const LIVE = process.env["IRONFLOW_INTEGRATION"] === "1";

interface DocMemory {
  [docId: string]: { docId: string; status: string; category?: string };
}

describe.skipIf(!LIVE)("agents client — live server", () => {
  it("invokes the agent and reads its memory", async () => {
    ironflow.configure({
      serverUrl: process.env["IRONFLOW_SERVER_URL"]!,
      auth: { apiKey: process.env["IRONFLOW_API_KEY"] },
    });
    const docId = `live-${Date.now()}`;

    const result = await ironflow.agents.invoke<{ docId: string; category: string }>(
      "doc-processor",
      { docId, imageUrl: "https://example.com/invoice.png" },
      { timeoutMs: 30_000 }
    );
    expect(result.runId).toBeTruthy();
    expect(result.output).toEqual({ docId, category: "invoice" });

    const memory = await ironflow.agents.readMemory<DocMemory>("doc-processor-memory");
    expect(memory.state[docId]).toMatchObject({ docId, status: "published", category: "invoice" });
  }, 60_000);
});
