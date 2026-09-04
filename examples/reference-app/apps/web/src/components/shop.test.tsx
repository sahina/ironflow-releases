import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { IronflowProvider } from "@/components/ironflow-provider";
import { Shop } from "@/components/shop";
import type { ProjectedOrder } from "@/lib/orders";
import { fakeIronflow } from "@/test/fake-ironflow";

const SESSION = "8a1c2d3e4f5061728394a5b6c7d8e9f0";

// Shop reaches the engine only through the provider, so every render supplies
// the fake. That is the whole point of the seam: no module mocking anywhere.
function order(overrides: Partial<ProjectedOrder> = {}): ProjectedOrder {
  return {
    orderId: "0f3b6c1d9a4e47b28c5d1e6f70a2b3c4",
    status: "pending_approval",
    customerEmail: "ada@example.com",
    totalCents: 6900,
    currency: "USD",
    placedAt: "2026-03-04T05:06:07Z",
    demoSessionId: SESSION,
    timeline: [],
    ...overrides,
  };
}

function renderShop(client = fakeIronflow()) {
  render(
    <IronflowProvider client={client}>
      <Shop session={SESSION} dashboardUrl="http://127.0.0.1:49152" />
    </IronflowProvider>,
  );
  return client;
}

describe("the shop", () => {
  test("offers exactly the committed catalog, priced from it", () => {
    renderShop();

    // Three products, no more: the catalog is committed and the UI does not
    // invent items the ordering service would refuse.
    expect(screen.getByRole("heading", { name: "Desk Lamp" })).toBeInTheDocument();
    expect(screen.getByText("$45.00")).toBeInTheDocument();
    expect(screen.getByText("$12.00")).toBeInTheDocument();
    expect(screen.getByText("$189.00")).toBeInTheDocument();
  });

  test("totals the cart from the catalog as items are added", async () => {
    const user = userEvent.setup();
    renderShop();

    await user.click(screen.getByRole("button", { name: "Add Desk Lamp" }));
    await user.click(screen.getByRole("button", { name: "Add Notebook" }));
    await user.click(screen.getByRole("button", { name: "Add Notebook" }));

    // One desk lamp and two notebooks: the same cart, and the same total, the
    // contract fixture and the Go service use.
    expect(screen.getByTestId("cart-total")).toHaveTextContent("$69.00");
  });

  test("places an order with the catalog total, a fresh id and the demo session", async () => {
    const user = userEvent.setup();
    const client = renderShop();

    await user.click(screen.getByRole("button", { name: "Add Desk Lamp" }));
    await user.click(screen.getByRole("button", { name: "Add Notebook" }));
    await user.click(screen.getByRole("button", { name: "Add Notebook" }));
    await user.selectOptions(screen.getByLabelText("Email"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: "Place order" }));

    expect(client.emitted).toHaveLength(1);
    const [command] = client.emitted;
    expect(command.event).toBe("place.order");
    // The payload contracts/schemas/place.order.v1.schema.json describes. The
    // total is the browser's display value; the ordering service recomputes it.
    expect(command.data).toMatchObject({
      customerEmail: "ada@example.com",
      items: [
        { sku: "sku_desk_lamp", quantity: 1 },
        { sku: "sku_notebook", quantity: 2 },
      ],
      totalCents: 6900,
      currency: "USD",
      paymentMethodToken: "pm_success",
    });
    const orderId = (command.data as { orderId: string }).orderId;
    expect(orderId).toMatch(/^[0-9a-f]{32}$/);
    expect(command.metadata).toMatchObject({
      correlationId: orderId,
      producer: "web",
      demoSessionId: SESSION,
    });
  });

  test("a second click cannot place the order twice", async () => {
    const user = userEvent.setup();
    const client = fakeIronflow();
    // Hold the command in flight, the way a slow engine would. Without a guard
    // the presenter's double-click becomes two orders.
    let release = () => {};
    const inFlight = new Promise<void>((resolve) => (release = resolve));
    const emit = client.emit.bind(client);
    client.emit = async (event, data, metadata) => {
      await inFlight;
      return emit(event, data, metadata);
    };
    renderShop(client);

    await user.click(screen.getByRole("button", { name: "Add Desk Lamp" }));
    await user.selectOptions(screen.getByLabelText("Email"), "ada@example.com");
    const place = screen.getByRole("button", { name: "Place order" });
    await user.click(place);
    await user.click(place);

    release();
    await waitFor(() => expect(client.emitted).toHaveLength(1));
  });

  test("shows the orders this session already has", async () => {
    // A reload does not lose the demo: history stays in the engine and the
    // session id in this browser decides what comes back.
    const placed = order({ status: "paid" });
    renderShop(fakeIronflow({ orders: { [placed.orderId]: placed } }));

    expect(await screen.findByText("Paid")).toBeInTheDocument();
  });

  test("follows an order's live state without a reload", async () => {
    // The whole demo hangs on this: an approval happens in another tab, in
    // another service, and the customer's page moves on its own.
    const placed = order({ status: "pending_approval" });
    const client = fakeIronflow({ orders: { [placed.orderId]: placed } });
    renderShop(client);
    expect(await screen.findByText("Waiting for approval")).toBeInTheDocument();

    client.publish({ orders: { [placed.orderId]: { ...placed, status: "processing_payment" } } });

    expect(await screen.findByText("Taking payment")).toBeInTheDocument();
  });

  test("refuses an order the ordering service would reject anyway", async () => {
    // An empty cart and a missing email both fail the wire schema. Catching
    // them here keeps a failed run out of the demo's timeline.
    const user = userEvent.setup();
    const client = renderShop();

    await user.click(screen.getByRole("button", { name: "Place order" }));

    expect(client.emitted).toHaveLength(0);
    expect(screen.getByRole("alert")).toHaveTextContent("Add an item and choose a customer");
  });

  test("each order carries its own event timeline", async () => {
    const placed = order({
      timeline: [{ event: "order.placed", producer: "orders-go", language: "Go", at: "2026-03-04T05:06:07Z" }],
    });
    renderShop(fakeIronflow({ orders: { [placed.orderId]: placed } }));

    expect(await screen.findByText("Events (1)")).toBeInTheDocument();
  });

  test("sends the demo scenario the customer picked", async () => {
    // Three scenarios, three tokens: pm_success pays, pm_decline is refused for
    // good, pm_crash stops the payment worker mid-flight. All three are in
    // contracts/schemas/common.v1.schema.json, so all three must be reachable.
    const user = userEvent.setup();
    const client = renderShop();

    await user.click(screen.getByRole("button", { name: "Add Desk Lamp" }));
    await user.selectOptions(screen.getByLabelText("Email"), "ada@example.com");
    await user.selectOptions(screen.getByLabelText("Demo scenario"), "pm_decline");
    await user.click(screen.getByRole("button", { name: "Place order" }));

    expect(client.emitted[0].data).toMatchObject({ paymentMethodToken: "pm_decline" });
  });

  test("links an order to the run that placed it", async () => {
    // The run id comes back from the command and is the only way this UI can
    // point at the run in the Ironflow dashboard.
    const user = userEvent.setup();
    const client = renderShop();

    await user.click(screen.getByRole("button", { name: "Add Desk Lamp" }));
    await user.selectOptions(screen.getByLabelText("Email"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: "Place order" }));

    const placedId = (client.emitted[0].data as { orderId: string }).orderId;
    client.publish({ orders: { [placedId]: order({ orderId: placedId }) } });

    const link = await screen.findByRole("link", { name: /run/i });
    expect(link).toHaveAttribute("href", "http://127.0.0.1:49152/runs/run-1");
  });

  test("says the engine is unreachable instead of showing nothing", async () => {
    const client = fakeIronflow();
    client.getOrders = async () => {
      throw new Error("fetch failed");
    };
    renderShop(client);

    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot reach Ironflow");
  });

  test("offers a handful of sample customers rather than a free-text field", () => {
    // Nobody types an address into a demo. The list is fixed so a presenter
    // places an order in two clicks, and every value is a reserved
    // example.com address that can never reach a real inbox.
    renderShop();

    const customers = screen.getByLabelText("Email");
    const addresses = Array.from(customers.querySelectorAll("option"))
      .map((option) => option.getAttribute("value"))
      .filter((value) => value !== "");

    expect(addresses).toHaveLength(5);
    expect(addresses.every((address) => address?.endsWith("@example.com"))).toBe(true);
    // Starts unchosen, so "place an order with no customer" stays a real path.
    expect((customers as HTMLSelectElement).value).toBe("");
  });
});
