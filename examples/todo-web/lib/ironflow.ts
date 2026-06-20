"use client";

import { ironflow } from "@ironflow/browser";

ironflow.configure({
  serverUrl: process.env.NEXT_PUBLIC_IRONFLOW_SERVER_URL,
});

// Connect to enable real-time subscriptions
ironflow.connect().catch((err) => {
  console.error("[ironflow] Failed to connect:", err);
});
