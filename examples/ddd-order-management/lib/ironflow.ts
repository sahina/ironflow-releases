"use client";
import { ironflow } from "@ironflow/browser";

if (!ironflow.isConfigured) {
  ironflow.configure({
    serverUrl: process.env.NEXT_PUBLIC_IRONFLOW_SERVER_URL || "http://localhost:9123",
  });
}

export { ironflow };
