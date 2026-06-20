// Walkthrough Step 2 — thin HTTP handler that dispatches a command.
//
// The route authenticates, validates input shape, builds the command, and
// emits `create.order`. The `place-order` function in worker.ts runs the
// durable handler (Step 3). We return 202 because the read model is
// eventually consistent (Step 10).

import { NextRequest, NextResponse } from "next/server";
import { ironflow } from "../../../lib/ironflow-server";
import type { PlaceOrderCommand, ShippingAddress } from "../../../lib/types";
import { EVENTS } from "../../../lib/events";

// ────────────────────────────────────────────────────────────────────────────
// ⚠️  DEMO-ONLY AUTH STUB  ⚠️
// This returns a hard-coded user and the route later trusts
// `body.customerId ?? user.id` so the example's frontend can switch customers
// via a dropdown. In production you must:
//   - replace `authenticate()` with real auth middleware, and
//   - drop the `body.customerId ?? ` fallback (always derive customerId from
//     the authenticated principal, never from the request body).
// Leaving this unchanged ships an authorization bypass.
// ────────────────────────────────────────────────────────────────────────────
async function authenticate(_req: NextRequest) {
  return { id: "cust-001", orgId: "org-demo" };
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_ITEMS = 50;

class ValidationError extends Error {}

function requireString(
  value: unknown,
  field: string,
  { max = 256 }: { max?: number } = {},
): string {
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be a string`);
  }
  if (value.length === 0) throw new ValidationError(`${field} must not be empty`);
  if (value.length > max) {
    throw new ValidationError(`${field} exceeds ${max} characters`);
  }
  return value;
}

function requireId(value: unknown, field: string): string {
  const s = requireString(value, field, { max: 64 });
  if (!ID_RE.test(s)) {
    throw new ValidationError(`${field} must match ${ID_RE}`);
  }
  return s;
}

function requireShippingAddress(value: unknown): ShippingAddress {
  if (typeof value !== "object" || value === null) {
    throw new ValidationError("shippingAddress must be an object");
  }
  const v = value as Record<string, unknown>;
  return {
    street: requireString(v.street, "shippingAddress.street"),
    city: requireString(v.city, "shippingAddress.city"),
    zip: requireString(v.zip, "shippingAddress.zip", { max: 32 }),
    country: requireString(v.country, "shippingAddress.country", { max: 64 }),
  };
}

function requireItems(
  value: unknown,
): Array<{ productId: string; qty: number }> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError("items must be a non-empty array");
  }
  if (value.length > MAX_ITEMS) {
    throw new ValidationError(`items exceeds ${MAX_ITEMS} entries`);
  }
  return value.map((raw, i) => {
    if (typeof raw !== "object" || raw === null) {
      throw new ValidationError(`items[${i}] must be an object`);
    }
    const item = raw as Record<string, unknown>;
    const qty = Number(item.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 1000) {
      throw new ValidationError(`items[${i}].qty must be an integer 1..1000`);
    }
    return {
      productId: requireId(item.productId, `items[${i}].productId`),
      qty,
    };
  });
}

type ValidatedBody = {
  orderId: string;
  customerId?: string;
  commandId?: string;
  items: Array<{ productId: string; qty: number }>;
  shippingAddress: ShippingAddress;
};

function validateBody(raw: unknown): ValidatedBody {
  if (typeof raw !== "object" || raw === null) {
    throw new ValidationError("request body must be a JSON object");
  }
  const body = raw as Record<string, unknown>;
  return {
    orderId: requireId(body.orderId, "orderId"),
    customerId:
      body.customerId === undefined
        ? undefined
        : requireId(body.customerId, "customerId"),
    commandId:
      body.commandId === undefined
        ? undefined
        : requireId(body.commandId, "commandId"),
    items: requireItems(body.items),
    shippingAddress: requireShippingAddress(body.shippingAddress),
  };
}

export async function POST(req: NextRequest) {
  try {
    const user = await authenticate(req);
    const body = validateBody(await req.json());

    const command: PlaceOrderCommand = {
      data: {
        orderId: body.orderId,
        customerId: body.customerId ?? user.id,
        items: body.items,
        shippingAddress: body.shippingAddress,
      },
      metadata: {
        commandId: body.commandId ?? crypto.randomUUID(),
        issuedAt: new Date().toISOString(),
        issuedBy: user.id,
        correlationId: req.headers.get("x-request-id") ?? undefined,
        tenantId: user.orgId,
        traceId: req.headers.get("traceparent") ?? undefined,
      },
    };

    const result = await ironflow.emit(EVENTS.CreateOrder, command);

    return NextResponse.json(
      {
        orderId: command.data.orderId,
        commandId: command.metadata.commandId,
        eventId: result.eventId,
        runIds: result.runIds,
      },
      { status: 202 },
    );
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
