// The "aggregate" is a pattern, not a framework class. Walkthrough Step 4.
//
// foldOrder — replays past events into current state.
// placeOrder — validates invariants and returns new domain events.

import type { StreamEvent } from "@ironflow/node";
import { NonRetryableError } from "@ironflow/node";
import type { Customer, Product } from "./enrichment";
import type { OrderPlacedData, OrderState, PlaceOrderCommand } from "./types";
import { STREAM_EVENTS } from "./events";

export function foldOrder(events: StreamEvent[]): OrderState {
  const initial: OrderState = {
    id: "",
    status: null,
    items: [],
    customerId: null,
    totalAmount: 0,
    version: 0,
  };

  return events.reduce<OrderState>((state, ev) => {
    const data = (ev.data ?? {}) as Record<string, unknown>;
    switch (ev.name) {
      case STREAM_EVENTS.OrderPlaced:
        return {
          ...state,
          id: data.orderId as string,
          status: "placed",
          items: (data.items as OrderState["items"]) ?? [],
          customerId: (data.customer as { id: string } | undefined)?.id ?? null,
          totalAmount: (data.totalAmount as number) ?? 0,
          version: ev.entityVersion,
        };
      case STREAM_EVENTS.OrderShipped:
        return { ...state, status: "shipped", version: ev.entityVersion };
      case STREAM_EVENTS.OrderCancelled:
        return { ...state, status: "cancelled", version: ev.entityVersion };
      default:
        return { ...state, version: ev.entityVersion };
    }
  }, initial);
}

export type OrderPlacedEvent = {
  name: typeof STREAM_EVENTS.OrderPlaced;
  data: OrderPlacedData;
};

export function placeOrder(
  state: OrderState,
  data: PlaceOrderCommand["data"],
  customer: Customer,
  products: Product[],
  occurredAt: string,
): OrderPlacedEvent[] {
  // Domain invariants are deterministic — retrying won't fix them. Use
  // NonRetryableError so the engine fails the run immediately instead of
  // burning the retry schedule on a known-bad command.
  if (state.status !== null) throw new NonRetryableError("Order already exists");
  if (customer.isBlocked) throw new NonRetryableError("Customer cannot place orders");
  if (products.some((p) => !p.isAvailable))
    throw new NonRetryableError("Product unavailable");

  const lineItems = products.map((p) => ({
    productId: p.id,
    name: p.name,
    price: p.currentPrice,
    qty: data.items.find((i) => i.productId === p.id)!.qty,
  }));
  const totalAmount = lineItems.reduce((sum, li) => sum + li.price * li.qty, 0);

  return [
    {
      name: STREAM_EVENTS.OrderPlaced,
      data: {
        orderId: data.orderId,
        customer: {
          id: customer.id,
          name: customer.name,
          email: customer.email,
        },
        items: lineItems,
        shippingAddress: data.shippingAddress,
        totalAmount,
        occurredAt,
      },
    },
  ];
}

// export type OrderEvent = OrderPlacedEvent | OrderShippedEvent | OrderCancelledEvent;
