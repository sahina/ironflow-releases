"use client";

import { useState } from "react";

import { useIronflow } from "@/components/ironflow-provider";
import { Timeline } from "@/components/timeline";
import { type CartLine, cartTotalCents, catalogProducts, formatCents } from "@/lib/contracts";
import { newEntityId } from "@/lib/ids";
import { statusLabel } from "@/lib/orders";
import { useOrders } from "@/lib/use-orders";

// The three demo scenarios, named by what the audience will see rather than by
// the token on the wire. contracts/schemas/common.v1.schema.json is the source
// of the tokens themselves.
// Five stand-in customers. A demo is placed by a presenter, not typed by one,
// and every address is under example.com — the domain reserved for exactly this
// so a stray notification can never reach a real inbox.
const CUSTOMERS = [
  "ada@example.com",
  "grace@example.com",
  "alan@example.com",
  "katherine@example.com",
  "margaret@example.com",
];

const SCENARIOS = [
  { token: "pm_success", label: "Payment succeeds" },
  { token: "pm_decline", label: "Payment is declined" },
  { token: "pm_crash", label: "Payment worker crashes mid-flight" },
] as const;

export function Shop({ session, dashboardUrl }: { session: string; dashboardUrl: string }) {
  const ironflow = useIronflow();
  const [cart, setCart] = useState<CartLine[]>([]);
  const [email, setEmail] = useState("");
  const [placing, setPlacing] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [scenario, setScenario] = useState<string>(SCENARIOS[0].token);
  // The run each order started, kept from the command result: it is the only
  // handle this UI has on the run behind an order.
  const [runs, setRuns] = useState<Record<string, string>>({});
  const { orders, error } = useOrders(session);

  const add = (sku: string) =>
    setCart((lines) => {
      const existing = lines.find((line) => line.sku === sku);
      if (!existing) return [...lines, { sku, quantity: 1 }];
      return lines.map((line) => (line.sku === sku ? { ...line, quantity: line.quantity + 1 } : line));
    });

  const place = async () => {
    // Both of these fail contracts/schemas/place.order.v1.schema.json, so the
    // run would fail anyway. Refusing here keeps a red run out of the demo.
    if (cart.length === 0 || email.trim() === "") {
      setRefusal("Add an item and choose a customer before placing the order.");
      return;
    }
    setRefusal(undefined);
    // A presenter double-clicks. Without this guard that is two orders, and the
    // engine cannot dedupe them: each carries its own fresh order id.
    if (placing) return;
    setPlacing(true);
    const orderId = newEntityId();
    const result = await ironflow.emit(
      "place.order",
      {
        orderId,
        customerEmail: email,
        items: cart,
        // A display value. The ordering service reprices it from the same
        // catalog and refuses the command if the two disagree.
        totalCents: cartTotalCents(cart),
        currency: "USD",
        paymentMethodToken: scenario,
      },
      { correlationId: orderId, causationId: orderId, producer: "web", demoSessionId: session },
    );
    if (result.runIds[0]) setRuns((known) => ({ ...known, [orderId]: result.runIds[0] }));
    setPlacing(false);
  };

  return (
    <section aria-label="Shop">
      <h1>Shop</h1>
      <ul>
        {catalogProducts.map((product) => (
          <li key={product.sku}>
            <h3>{product.name}</h3>
            <p>{formatCents(product.unitPriceCents)}</p>
            <button type="button" onClick={() => add(product.sku)}>
              Add {product.name}
            </button>
          </li>
        ))}
      </ul>
      <p data-testid="cart-total">{formatCents(cartTotalCents(cart))}</p>
      <label htmlFor="demo-scenario">Demo scenario</label>
      <select id="demo-scenario" value={scenario} onChange={(event) => setScenario(event.target.value)}>
        {SCENARIOS.map((choice) => (
          <option key={choice.token} value={choice.token}>
            {choice.label}
          </option>
        ))}
      </select>
      <label htmlFor="customer-email">Email</label>
      <select id="customer-email" value={email} onChange={(event) => setEmail(event.target.value)}>
        {/* Empty first, so placing an order without choosing a customer stays a
            real path the shop refuses rather than an impossible one. */}
        <option value="">Choose a customer…</option>
        {CUSTOMERS.map((address) => (
          <option key={address} value={address}>
            {address}
          </option>
        ))}
      </select>
      <button type="button" onClick={() => void place()} disabled={placing}>
        Place order
      </button>
      {refusal && <p role="alert">{refusal}</p>}
      {error && <p role="alert">Cannot reach Ironflow — {error}</p>}
      <ul aria-label="Your orders">
        {orders.map((placed) => (
          <li key={placed.orderId}>
            <span>{formatCents(placed.totalCents)}</span>
            <span data-testid="order-status">{statusLabel(placed.status)}</span>
            <Timeline order={placed} dashboardUrl={dashboardUrl} runId={runs[placed.orderId]} />
          </li>
        ))}
      </ul>
    </section>
  );
}
