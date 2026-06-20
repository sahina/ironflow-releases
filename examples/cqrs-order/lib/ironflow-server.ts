import { createClient } from "@ironflow/node";

// Shared node SDK client used by the Next.js API route and the worker.
// createClient() reads IRONFLOW_SERVER_URL / IRONFLOW_API_KEY from env.
export const ironflow = createClient({
  serverUrl:
    process.env.IRONFLOW_SERVER_URL || "http://localhost:9123",
});
