import { describe, expect, test } from "vitest";

import { cartTotalCents } from "@/lib/contracts";

describe("the committed catalog", () => {
  test("prices a cart the way the ordering service does", () => {
    // The cart in contracts/fixtures/valid/place.order.json, and the total the
    // Go service computes from the same file: one desk lamp (4500) plus two
    // notebooks (2 x 1200). The literal is the point — summing the catalog the
    // way the code does would pass no matter what the code did.
    const total = cartTotalCents([
      { sku: "sku_desk_lamp", quantity: 1 },
      { sku: "sku_notebook", quantity: 2 },
    ]);

    expect(total).toBe(6900);
  });

  test("refuses a SKU the catalog does not have", () => {
    // The buttons come from the catalog, so this is unreachable from the UI —
    // but a silent NaN total would be worse than a thrown error if it ever is.
    expect(() => cartTotalCents([{ sku: "sku_not_real", quantity: 1 }])).toThrow(/not in the catalog/);
  });
});
