// Domain + command types for the CQRS walkthrough example.
// These are illustrative user code — not SDK types. See docs/tutorials/cqrs-walkthrough.md.

export type LineItem = {
  productId: string;
  name: string;
  price: number;
  qty: number;
};

export type ShippingAddress = {
  street: string;
  city: string;
  zip: string;
  country: string;
};

export type PlaceOrderCommand = {
  data: {
    orderId: string;
    customerId: string;
    items: { productId: string; qty: number }[];
    shippingAddress: ShippingAddress;
  };
  metadata: {
    commandId: string;
    issuedAt: string;
    issuedBy: string;
    correlationId?: string;
    tenantId?: string;
    traceId?: string;
  };
};

export type OrderState = {
  id: string;
  status: "placed" | "shipped" | "cancelled" | null;
  items: LineItem[];
  customerId: string | null;
  totalAmount: number;
  version: number;
};

// Projection view shapes — what the read models expose.

export type OrderDetail = {
  orderId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  items: LineItem[];
  shippingAddress: ShippingAddress;
  totalAmount: number;
  status: "placed" | "shipped" | "cancelled";
  placedAt: string;
  shippedAt?: string;
  cancelledAt?: string;
  trackingNumber?: string;
  cancellationReason?: string;
};

export type OrderSummary = {
  orderId: string;
  placedAt: string;
  totalAmount: number;
  status: string;
  summary: string;
};

export type OrderDetailViewState = {
  orders: Record<string, OrderDetail>;
};

export type CustomerOrdersListState = {
  orders: OrderSummary[];
};

// Event payload types (what lives in StreamEvent.data). Cross-cutting
// plumbing (causation, correlation, tenant, trace) rides in the event's
// `metadata` slot, not in `data` — see walkthrough Step 5.

export type OrderPlacedData = {
  orderId: string;
  customer: { id: string; name: string; email: string };
  items: LineItem[];
  shippingAddress: ShippingAddress;
  totalAmount: number;
  occurredAt: string;
};

export type OrderShippedData = {
  orderId: string;
  trackingNumber: string;
};

export type OrderCancelledData = {
  orderId: string;
  reason: string;
};

// Cross-cutting metadata passed to `streams.append(..., { metadata })`.
export type EventMeta = {
  causationId: string;
  correlationId?: string;
  tenantId?: string;
  traceId?: string;
  issuedBy?: string;
};
