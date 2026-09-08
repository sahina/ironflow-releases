import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { IronflowProvider } from "@/components/ironflow-provider";
import { Timeline } from "@/components/timeline";
import type { ProjectedOrder } from "@/lib/orders";
import { fakeIronflow, type FakeEngineState } from "@/test/fake-ironflow";

const DASHBOARD = "http://127.0.0.1:49152";

const order: ProjectedOrder = {
  orderId: "0f3b6c1d9a4e47b28c5d1e6f70a2b3c4",
  status: "paid",
  customerEmail: "ada@example.com",
  totalCents: 6900,
  currency: "USD",
  placedAt: "2026-03-04T05:06:07Z",
  timeline: [
    {
      event: "order.placed",
      producer: "orders-go",
      language: "Go",
      at: "2026-03-04T05:06:07Z",
      eventId: "evt-placed",
    },
    {
      event: "payment.captured",
      producer: "payments-node",
      language: "TypeScript",
      at: "2026-03-04T05:08:00Z",
      eventId: "evt-captured",
    },
    {
      event: "notification.sent",
      producer: "notifications-python",
      language: "Python",
      at: "2026-03-04T05:08:01Z",
    },
  ],
};

function renderTimeline(state: FakeEngineState = {}) {
  const client = fakeIronflow({ orders: {} }, state);
  render(
    <IronflowProvider client={client}>
      <Timeline order={order} dashboardUrl={DASHBOARD} />
    </IronflowProvider>,
  );
  return client;
}

describe("the event timeline", () => {
  test("names the service and the language behind each fact", () => {
    // The point of the whole example: one story crossing three languages, and
    // the timeline is where an audience sees the crossing.
    renderTimeline();

    expect(screen.getByRole("listitem", { name: "payment.captured" })).toHaveTextContent("TypeScript");
    expect(screen.getByRole("listitem", { name: "notification.sent" })).toHaveTextContent("Python");
  });

  test("starts collapsed so it never buries the order", () => {
    renderTimeline();

    expect(screen.getByRole("group")).not.toHaveAttribute("open");
  });

  test("keeps raw payloads out of the default view", () => {
    // The timeline explains the story; the dashboard holds the data. Rendering
    // event payloads here would rebuild the run inspector by accident.
    renderTimeline();

    expect(screen.queryByText(/totalCents/)).toBeNull();
    expect(screen.queryByText(/customerEmail/)).toBeNull();
  });

  test("links to the order's entity stream in the Ironflow dashboard", () => {
    renderTimeline();

    expect(screen.getByRole("link", { name: /order stream/i })).toHaveAttribute(
      "href",
      `${DASHBOARD}/streams/order-0f3b6c1d9a4e47b28c5d1e6f70a2b3c4`,
    );
  });

  test("asks for runs only once the timeline is opened", async () => {
    // Every order on the operations page holds one of these. Resolving links
    // for all of them on render would poll the engine for links nobody looked
    // at.
    const client = renderTimeline({
      runs: [{ id: "run-1", function_id: "order-approval-process", event_id: "evt-placed" }],
    });

    expect(client.runsRequested).toBe(0);
    await userEvent.click(screen.getByText(/Events/));
    await waitFor(() => expect(client.runsRequested).toBe(1));
  });

  test("lists the runs this order caused, even when the engine is slow", async () => {
    // A real engine does not answer in a microtask. An effect that tears itself
    // down while its own fetch is in flight passes against a fake that does.
    renderTimeline({
      runs: [
        { id: "run-1", function_id: "order-approval-process", event_id: "evt-placed" },
        { id: "run-2", function_id: "record-payment", event_id: "evt-captured" },
        { id: "run-3", function_id: "order-approval-process", event_id: "evt-other" },
      ],
      runsDelayMs: 50,
    });

    await userEvent.click(screen.getByText(/Events/));

    const list = await screen.findByRole("list", { name: "Runs for this order" });
    await waitFor(() => expect(within(list).getAllByRole("link")).toHaveLength(2));
    expect(within(list).getByRole("link", { name: /record-payment/ })).toHaveAttribute(
      "href",
      `${DASHBOARD}/runs/run-2`,
    );
    // A run started by a fact outside this timeline does not belong here.
    expect(list).not.toContainHTML("run-3");
  });

  test("an order no recent run names lists none", async () => {
    // Recent runs are a window, and an older order falls out of it. That is not
    // an error, and it may not render a link that 404s.
    //
    // The delay is the assertion: without it this passes before the fetch has
    // even resolved, which is also what a broken filter would do.
    const client = renderTimeline({
      runs: [{ id: "run-1", function_id: "order-approval-process", event_id: "evt-other" }],
      runsDelayMs: 20,
    });

    await userEvent.click(screen.getByText(/Events/));
    await waitFor(() => expect(client.runsRequested).toBe(1));
    await waitFor(() =>
      expect(screen.queryByRole("list", { name: "Runs for this order" })).toBeNull(),
    );
  });

  test("links the payment stream only once a payment fact exists", async () => {
    // Payments creates `payment-{id}` when it writes its first fact. Linking
    // earlier points at a stream that is not there.
    renderTimeline();

    expect(screen.getByRole("link", { name: /order stream/i })).toHaveAttribute(
      "href",
      `${DASHBOARD}/streams/order-${order.orderId}`,
    );
    expect(screen.queryByRole("link", { name: /payment stream/i })).toBeNull();
  });

  test("links the payment stream once the card has been held", () => {
    const client = fakeIronflow({ orders: {} });
    render(
      <IronflowProvider client={client}>
        <Timeline
          order={{ ...order, authorizationId: "auth_1" }}
          dashboardUrl={DASHBOARD}
        />
      </IronflowProvider>,
    );

    expect(screen.getByRole("link", { name: /payment stream/i })).toHaveAttribute(
      "href",
      `${DASHBOARD}/streams/payment-${order.orderId}`,
    );
  });

  test("an engine that cannot list runs still renders the timeline", async () => {
    renderTimeline({ runsFail: true });

    await userEvent.click(screen.getByText(/Events/));

    expect(screen.getByRole("listitem", { name: "order.placed" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /run/i })).toBeNull();
  });
});
