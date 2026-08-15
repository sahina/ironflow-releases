// Same-origin proxy to the worker's chaos server.
//
// The browser can't call http://localhost:3100 directly without CORS, and adding
// CORS to a demo worker is more code than forwarding one request.

const CHAOS_URL = `http://localhost:${process.env.CHAOS_PORT ?? 3100}`;

export async function POST(request: Request) {
  const { action, mode } = (await request.json()) as { action: string; mode?: string };

  const path =
    action === "payment-mode" ? `/payment-mode?mode=${encodeURIComponent(mode ?? "normal")}` : `/${action}`;

  try {
    const response = await fetch(`${CHAOS_URL}${path}`, { method: "POST" });
    return Response.json(await response.json(), { status: response.status });
  } catch {
    // A crashed worker refuses connections — expected right after you hit
    // "Crash worker", and not something the UI should show as a real error.
    return Response.json({ ok: false, workerDown: true }, { status: 503 });
  }
}

export async function GET() {
  try {
    const response = await fetch(`${CHAOS_URL}/state`);
    return Response.json(await response.json());
  } catch {
    return Response.json({ workerDown: true }, { status: 503 });
  }
}
