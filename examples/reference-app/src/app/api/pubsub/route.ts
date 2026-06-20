import { createClient } from "@ironflow/node"
import { NextResponse, type NextRequest } from "next/server"

const IRONFLOW_SERVER_URL = process.env.IRONFLOW_SERVER_URL || "http://localhost:9123"
const IRONFLOW_API_KEY = process.env.IRONFLOW_API_KEY

const client = createClient({ serverUrl: IRONFLOW_SERVER_URL, apiKey: IRONFLOW_API_KEY })

// POST: Publish a message to a topic
// Note: This route is intended for use by the demo UI only. In production,
// protect this endpoint with authentication (e.g., session tokens or API keys).
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { topic, data } = body
  if (!topic || typeof topic !== "string") {
    return NextResponse.json({ error: "topic is required and must be a string" }, { status: 400 })
  }

  try {
    const result = await client.publish(topic, (data as Record<string, unknown>) ?? {})
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to publish"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
