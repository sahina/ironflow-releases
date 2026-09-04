// The browser's view of the shared wire contract.
//
// `contracts/` is read in place, never copied: the catalog here is the same
// file the Go ordering service prices from, so the display total and the
// authoritative total cannot drift.

import catalog from "@contracts/catalog.json";

export type CatalogProduct = {
  sku: string;
  name: string;
  unitPriceCents: number;
};

export type CartLine = {
  sku: string;
  quantity: number;
};

const bySku = new Map<string, CatalogProduct>(catalog.products.map((product) => [product.sku, product]));

/**
 * The cart total a customer sees. It is a display value: the ordering service
 * recalculates it from this same catalog and refuses a command that disagrees.
 */
export function cartTotalCents(lines: CartLine[]): number {
  return lines.reduce((total, line) => {
    const product = bySku.get(line.sku);
    if (!product) throw new Error(`${line.sku} is not in the catalog`);
    return total + product.unitPriceCents * line.quantity;
  }, 0);
}

/**
 * The entity id of an order's stream. The ordering service names it the same
 * way (`internal/order/model.go`); this is the browser's half of that rule.
 */
export function orderStreamId(orderId: string): string {
  return `order-${orderId}`;
}

/**
 * The entity id of an order's payment stream. Payments names it the same way
 * (`services/payments-node/src/payment.ts`); this is the browser's half.
 */
export function paymentStreamId(orderId: string): string {
  return `payment-${orderId}`;
}

/** Every product a customer may order. */
export const catalogProducts: CatalogProduct[] = catalog.products;

/** Integer cents as the customer reads them. */
export function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: catalog.currency }).format(cents / 100);
}
