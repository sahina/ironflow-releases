// Illustrative enrichment — stands in for your customer repository and
// product catalog. The walkthrough fetches these at command-handler time
// to freeze "current" values into domain events (see Step 3).

import { NonRetryableError } from "@ironflow/node";

export type Customer = {
  id: string;
  name: string;
  email: string;
  isBlocked: boolean;
};

export type Product = {
  id: string;
  name: string;
  currentPrice: number;
  isAvailable: boolean;
};

const CUSTOMERS: Record<string, Customer> = {
  "cust-001": {
    id: "cust-001",
    name: "Ada Lovelace",
    email: "ada@example.com",
    isBlocked: false,
  },
  "cust-002": {
    id: "cust-002",
    name: "Grace Hopper",
    email: "grace@example.com",
    isBlocked: false,
  },
  "cust-blocked": {
    id: "cust-blocked",
    name: "Blocked Customer",
    email: "blocked@example.com",
    isBlocked: true,
  },
};

const PRODUCTS: Record<string, Product> = {
  "prod-widget": {
    id: "prod-widget",
    name: "Widget",
    currentPrice: 12.5,
    isAvailable: true,
  },
  "prod-gadget": {
    id: "prod-gadget",
    name: "Gadget",
    currentPrice: 24.99,
    isAvailable: true,
  },
  "prod-gizmo": {
    id: "prod-gizmo",
    name: "Gizmo",
    currentPrice: 7.25,
    isAvailable: true,
  },
};

export const customerRepo = {
  async getById(id: string): Promise<Customer> {
    const c = CUSTOMERS[id];
    if (!c) throw new NonRetryableError(`Unknown customer: ${id}`);
    return c;
  },
};

export const productCatalog = {
  async getMany(ids: string[]): Promise<Product[]> {
    return ids.map((id) => {
      const p = PRODUCTS[id];
      if (!p) throw new NonRetryableError(`Unknown product: ${id}`);
      return p;
    });
  },
};

export const DEMO_CUSTOMERS = Object.values(CUSTOMERS);
export const DEMO_PRODUCTS = Object.values(PRODUCTS);
