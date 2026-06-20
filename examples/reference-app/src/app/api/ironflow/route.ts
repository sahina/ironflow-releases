import { serve, createClient } from "@ironflow/node"
import { allFunctions } from "@/lib/functions"
import { allWebhooks } from "@/lib/webhooks"
import { NextResponse } from "next/server"

const IRONFLOW_SERVER_URL = process.env.IRONFLOW_SERVER_URL || "http://localhost:9123"
const IRONFLOW_API_KEY = process.env.IRONFLOW_API_KEY
const NEXT_PUBLIC_URL = process.env.NEXT_PUBLIC_URL || "http://localhost:3000"

const IRONFLOW_SIGNING_KEY = process.env.IRONFLOW_SIGNING_KEY

const handler = serve({
  functions: allFunctions,
  webhooks: allWebhooks,
  signingKey: IRONFLOW_SIGNING_KEY,
  // When no signing key is configured, skip verification (dev mode only).
  // In production, always set IRONFLOW_SIGNING_KEY to enable HMAC-SHA256 verification.
  skipVerification: !IRONFLOW_SIGNING_KEY,
})

export const POST = handler

/**
 * GET /api/ironflow — Register all functions with the Ironflow server.
 * Called by the IronflowProvider after connecting so that trigger() can find matching functions.
 */
export async function GET() {
  const client = createClient({ serverUrl: IRONFLOW_SERVER_URL, apiKey: IRONFLOW_API_KEY })
  const results: Array<{ id: string; created: boolean; error?: string }> = []

  for (const fn of allFunctions) {
    try {
      const res = await client.registerFunction({
        id: fn.config.id,
        name: fn.config.name || fn.config.id,
        triggers: fn.config.triggers,
        retry: fn.config.retry,
        timeoutMs: fn.config.timeout,
        concurrency: fn.config.concurrency,
        endpointUrl: `${NEXT_PUBLIC_URL}/api/ironflow`,
        actorKey: fn.config.actorKey,
      })
      results.push({ id: fn.config.id, created: res.created })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      results.push({ id: fn.config.id, created: false, error: message })
    }
  }

  return NextResponse.json({ registered: results })
}
