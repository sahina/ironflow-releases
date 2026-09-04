import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { IronflowProvider } from "@/components/ironflow-provider";
import { Operations } from "@/components/operations";
import type { OrdersProjection, ProjectedOrder } from "@/lib/orders";
import { fakeIronflow } from "@/test/fake-ironflow";

const SESSION = "8a1c2d3e4f5061728394a5b6c7d8e9f0";

const paymentWorker = () => ({
  id: "worker-1",
  function_ids: ["process-payment"],
  last_heartbeat: new Date().toISOString(),
});

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

function renderOperations(state: OrdersProjection, workers: unknown[] = [paymentWorker()]) {
  const client = fakeIronflow(state);
  client.listWorkers = async () => workers;
  render(
    <IronflowProvider client={client}>
      <Operations session={SESSION} dashboardUrl="http://127.0.0.1:49152" />
    </IronflowProvider>,
  );
  return client;
}

describe("the operations view", () => {
  test("queues only the orders that still need a decision", async () => {
    const waiting = order({ orderId: "aaaa", status: "pending_approval" });
    const paying = order({ orderId: "bbbb", status: "processing_payment" });
    renderOperations({ orders: { aaaa: waiting, bbbb: paying } });

    const queue = await screen.findByRole("list", { name: "Waiting for approval" });

    expect(queue).toHaveTextContent("ada@example.com");
    expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(1);
  });

  test("approving sends approve.order for that order", async () => {
    const user = userEvent.setup();
    const waiting = order();
    const client = renderOperations({ orders: { [waiting.orderId]: waiting } });

    await user.click(await screen.findByRole("button", { name: "Approve" }));

    expect(client.emitted).toHaveLength(1);
    const [command] = client.emitted;
    expect(command.event).toBe("approve.order");
    // The payload contracts/schemas/approve.order.v1.schema.json describes.
    expect(command.data).toEqual({ orderId: waiting.orderId, approvedBy: "operations@example.com" });
    expect(command.metadata).toMatchObject({
      correlationId: waiting.orderId,
      producer: "web",
      demoSessionId: SESSION,
    });
  });

  test("a second click cannot approve the same order twice", async () => {
    const user = userEvent.setup();
    const waiting = order();
    const client = renderOperations({ orders: { [waiting.orderId]: waiting } });
    // Hold the command in flight. The engine would refuse the second approval,
    // but a failed run in the demo's face is not the experience we want.
    let release = () => {};
    const inFlight = new Promise<void>((resolve) => (release = resolve));
    const emit = client.emit.bind(client);
    client.emit = async (event, data, metadata) => {
      await inFlight;
      return emit(event, data, metadata);
    };

    const approve = await screen.findByRole("button", { name: "Approve" });
    await user.click(approve);
    await user.click(approve);

    release();
    await waitFor(() => expect(client.emitted).toHaveLength(1));
  });

  test("a command the engine refuses is reported, and its button stays usable", async () => {
    const user = userEvent.setup();
    const waiting = order();
    const client = renderOperations({ orders: { [waiting.orderId]: waiting } });
    let refuse = true;
    const emit = client.emit.bind(client);
    client.emit = async (event, data, metadata) => {
      if (refuse) throw new Error("fetch failed");
      return emit(event, data, metadata);
    };

    const approve = await screen.findByRole("button", { name: "Approve" });
    await user.click(approve);

    // Silence plus a dead button is the worst outcome in front of an audience:
    // the presenter cannot tell a refused command from a slow one, and has no
    // way to retry it.
    await waitFor(() => expect(screen.getByText(/did not reach Ironflow/)).toBeInTheDocument());
    expect(approve).not.toBeDisabled();

    refuse = false;
    await user.click(approve);
    await waitFor(() => expect(client.emitted).toHaveLength(1));
  });

  test("says so when nothing is waiting", async () => {
    const paid = order({ status: "paid" });
    renderOperations({ orders: { [paid.orderId]: paid } });

    expect(await screen.findByText("No orders are waiting for approval.")).toBeInTheDocument();
  });

  test("says the engine is unreachable instead of showing an empty queue", async () => {
    // An empty queue and a dead engine look identical, and a presenter needs to
    // tell them apart in front of an audience.
    const client = fakeIronflow();
    client.getOrders = async () => {
      throw new Error("fetch failed");
    };
    render(
      <IronflowProvider client={client}>
        <Operations session={SESSION} dashboardUrl="http://127.0.0.1:49152" />
      </IronflowProvider>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot reach Ironflow");
  });
});

describe("the payment view", () => {
  test("shows how far each attempt got without inventing a fifth order state", async () => {
    const held = order({ orderId: "aaaa", status: "processing_payment", authorizationId: "auth_1" });
    const paid = order({ orderId: "bbbb", status: "paid", authorizationId: "auth_2", captureId: "cap_2" });
    const failed = order({ orderId: "cccc", status: "payment_failed", failureReason: "card_declined" });
    renderOperations({ orders: { aaaa: held, bbbb: paid, cccc: failed } });

    const payments = await screen.findByRole("list", { name: "Payments" });
    expect(payments).toHaveTextContent("Authorized");
    expect(payments).toHaveTextContent("Captured");
    expect(payments).toHaveTextContent("Declined");
  });

  // The gap between release and the worker's first fact. Real, and short: the
  // operator should see the order arrive rather than have it appear later.
  test("lists a released order before the worker has recorded anything", async () => {
    const released = order({ status: "processing_payment" });
    renderOperations({ orders: { [released.orderId]: released } });

    const payments = await screen.findByRole("list", { name: "Payments" });
    expect(payments).toHaveTextContent("Not started");
  });

  test("keeps an order still waiting for approval out of the payment list", async () => {
    const waiting = order({ status: "pending_approval" });
    renderOperations({ orders: { [waiting.orderId]: waiting } });

    await screen.findByRole("list", { name: "Waiting for approval" });
    expect(screen.queryByText("Not started")).not.toBeInTheDocument();
  });

  test("shows the decline reason the payment worker gave", async () => {
    const failed = order({ status: "payment_failed", failureReason: "card_declined" });
    renderOperations({ orders: { [failed.orderId]: failed } });

    expect(await screen.findByText(/card_declined/)).toBeInTheDocument();
  });

  test("says so when no attempt has started", async () => {
    const waiting = order({ status: "pending_approval" });
    renderOperations({ orders: { [waiting.orderId]: waiting } });

    expect(await screen.findByText("No payments have started.")).toBeInTheDocument();
  });
});

describe("the crash demonstration", () => {
  const held = () =>
    order({ status: "processing_payment", paymentMethodToken: "pm_crash", authorizationId: "auth_1" });

  test("tells the presenter the exact command to run once the hold exists", async () => {
    renderOperations({ orders: { [held().orderId]: held() } });

    expect(await screen.findByText(/make reference-app-crash-payment/)).toBeInTheDocument();
  });

  test("emits demo.payment.continue for that one order", async () => {
    const user = userEvent.setup();
    const parked = held();
    const client = renderOperations({ orders: { [parked.orderId]: parked } });

    await user.click(await screen.findByRole("button", { name: "Continue payment" }));

    expect(client.emitted).toHaveLength(1);
    const [command] = client.emitted;
    expect(command.event).toBe("demo.payment.continue");
    // The payload contracts/schemas/demo.payment.continue.v1.schema.json describes.
    expect(command.data).toEqual({ orderId: parked.orderId });
    expect(command.metadata).toMatchObject({ correlationId: parked.orderId, producer: "web", demoSessionId: SESSION });
  });

  test("a second click cannot release the same order twice", async () => {
    const user = userEvent.setup();
    const parked = held();
    const client = renderOperations({ orders: { [parked.orderId]: parked } });
    let release = () => {};
    const inFlight = new Promise<void>((resolve) => (release = resolve));
    const emit = client.emit.bind(client);
    client.emit = async (event, data, metadata) => {
      await inFlight;
      return emit(event, data, metadata);
    };

    const button = await screen.findByRole("button", { name: "Continue payment" });
    await user.click(button);
    await user.click(button);

    release();
    await waitFor(() => expect(client.emitted).toHaveLength(1));
  });

  // Offering it anywhere else emits a control event with no run waiting for it.
  test("offers no Continue payment for a scenario that never pauses", async () => {
    const straight = order({ status: "processing_payment", paymentMethodToken: "pm_success", authorizationId: "a" });
    renderOperations({ orders: { [straight.orderId]: straight } });

    await screen.findByRole("list", { name: "Payments" });
    expect(screen.queryByRole("button", { name: "Continue payment" })).not.toBeInTheDocument();
  });
});

describe("payment worker presence", () => {
  test("reports the worker running", async () => {
    renderOperations({ orders: {} });

    expect(await screen.findByText("Payment worker running")).toBeInTheDocument();
  });

  test("reports it gone, and says it comes back on its own", async () => {
    renderOperations({ orders: {} }, []);

    expect(await screen.findByText("Payment worker gone")).toBeInTheDocument();
    expect(screen.getByText(/restarts it automatically/)).toBeInTheDocument();
  });

  test("follows the worker back without a page reload", async () => {
    let workers: unknown[] = [];
    const client = fakeIronflow({ orders: {} });
    client.listWorkers = async () => workers;
    render(
      <IronflowProvider client={client}>
        <Operations session={SESSION} dashboardUrl="http://127.0.0.1:49152" />
      </IronflowProvider>,
    );
    expect(await screen.findByText("Payment worker gone")).toBeInTheDocument();

    workers = [paymentWorker()];
    await screen.findByText("Payment worker running", undefined, { timeout: 5_000 });
  });

  test("says nothing about the worker when the engine cannot be reached", async () => {
    const client = fakeIronflow({ orders: {} });
    client.listWorkers = async () => {
      throw new Error("fetch failed");
    };
    render(
      <IronflowProvider client={client}>
        <Operations session={SESSION} dashboardUrl="http://127.0.0.1:49152" />
      </IronflowProvider>,
    );

    // "gone" is a claim about the worker. An unreachable engine is a claim
    // about the engine, and the queue's own alert already makes it.
    await screen.findByRole("list", { name: "Waiting for approval" });
    expect(screen.queryByText("Payment worker gone")).not.toBeInTheDocument();
    expect(screen.queryByText("Payment worker running")).not.toBeInTheDocument();
  });
});
