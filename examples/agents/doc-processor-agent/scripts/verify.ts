// Read the doc-processor-memory projection and assert a docId is present.
// Used by `make demo-agent-crash-resume` to confirm the post-crash run completed.
//
//   pnpm verify -- <docId>
//
// Exits 0 if the docId is present with status="published", non-zero otherwise.

import { IronflowClient } from "@ironflow/node";

const [, , docIdArg] = process.argv;
if (!docIdArg) {
  console.error("usage: verify <docId>");
  process.exit(2);
}

const client = new IronflowClient({
  serverUrl: process.env.IRONFLOW_URL ?? "http://localhost:9123",
  apiKey: process.env.IRONFLOW_API_KEY,
});

interface DocState {
  docId: string;
  status: string;
  category?: string;
}

// A killed worker recovers via lease expiry, not NATS redelivery: 60-90s for
// its concurrency lease to expire (LeaseExpiry 90s) + up to 30s scanner tick +
// 30s RecoveryGrace + up to 30s pull-dispatch tick = 90s..3min. The old 90s
// default was BELOW that floor. These are compile-time constants in
// capacity.DefaultConfig() — `--dev` and IRONFLOW_STALE_CLAIM_THRESHOLD do not
// shorten them. See docs/explanation/crash-recovery.md (#1674).
const TIMEOUT_MS = Number(process.env.VERIFY_TIMEOUT_MS ?? 210000);
const POLL_MS = 500;
const deadline = Date.now() + TIMEOUT_MS;

// SDK 0.20.0+ peels the wire envelope inside `client.projections.get` —
// `result.state` is already the user state, typed via the generic. See #610.
while (Date.now() < deadline) {
  try {
    const projection = await client.projections.get<Record<string, DocState>>(
      "doc-processor-memory",
    );
    const entry = projection.state[docIdArg];
    if (entry?.status === "published") {
      console.log(
        `verified docId=${docIdArg} status=${entry.status} category=${entry.category ?? "?"}`,
      );
      process.exit(0);
    }
  } catch (err) {
    // projection not ready yet — keep polling
  }
  await new Promise((r) => setTimeout(r, POLL_MS));
}

console.error(`timed out waiting for docId=${docIdArg} in projection`);
process.exit(1);
