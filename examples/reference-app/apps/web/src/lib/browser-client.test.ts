import { beforeEach, describe, expect, test, vi } from "vitest";

import type { OrdersProjection } from "@/lib/orders";

type OnUpdate = (state: OrdersProjection | undefined) => void;

const sdk = vi.hoisted(() => ({
  configure: vi.fn(),
  subscribeToProjection: vi.fn(),
}));

vi.mock("@ironflow/browser", () => ({ ironflow: sdk }));

const settings = { serverUrl: "http://localhost:9123", apiKey: "ifkey_dev" };
const state = (id: string): OrdersProjection =>
  ({ orders: { [id]: { id } } }) as unknown as OrdersProjection;

let publish: OnUpdate;
let sdkUnsubscribe: ReturnType<typeof vi.fn>;

async function freshClient() {
  vi.resetModules();
  const { browserIronflow } = await import("@/lib/browser-client");
  return browserIronflow(settings);
}

beforeEach(() => {
  sdk.configure.mockReset();
  sdk.subscribeToProjection.mockReset();
  sdkUnsubscribe = vi.fn();
  sdk.subscribeToProjection.mockImplementation(async (_name: string, callbacks: { onUpdate: OnUpdate }) => {
    publish = callbacks.onUpdate;
    return { unsubscribe: sdkUnsubscribe };
  });
});

describe("the shared orders subscription", () => {
  test("opens one SDK subscription for every listener and fans each update out to all of them", async () => {
    const client = await freshClient();
    const shop = vi.fn();
    const operations = vi.fn();

    await Promise.all([client.subscribeToOrders(shop), client.subscribeToOrders(operations)]);
    publish(state("o-1"));

    expect(sdk.subscribeToProjection).toHaveBeenCalledTimes(1);
    expect(sdk.subscribeToProjection).toHaveBeenCalledWith("orders", expect.anything());
    expect(shop).toHaveBeenCalledWith(state("o-1"));
    expect(operations).toHaveBeenCalledWith(state("o-1"));
  });

  test("keeps delivering to the remaining listener after one unsubscribes", async () => {
    const client = await freshClient();
    const shop = vi.fn();
    const operations = vi.fn();
    const shopHandle = await client.subscribeToOrders(shop);
    await client.subscribeToOrders(operations);

    shopHandle.unsubscribe();
    publish(state("o-2"));

    expect(shop).not.toHaveBeenCalled();
    expect(operations).toHaveBeenCalledWith(state("o-2"));
  });

  test("closes the SDK subscription when the last listener leaves", async () => {
    const client = await freshClient();
    const handle = await client.subscribeToOrders(vi.fn());

    handle.unsubscribe();

    expect(sdkUnsubscribe).toHaveBeenCalledTimes(1);
  });

  test("hands an empty read model to listeners when the SDK publishes no state", async () => {
    const client = await freshClient();
    const shop = vi.fn();
    await client.subscribeToOrders(shop);

    publish(undefined);

    expect(shop).toHaveBeenCalledWith({ orders: {} });
  });

  test("retries failed subscriptions and removes failed listeners", async () => {
    let failedPublish!: OnUpdate;
    sdk.subscribeToProjection.mockImplementationOnce(async (_name: string, callbacks: { onUpdate: OnUpdate }) => {
      failedPublish = callbacks.onUpdate;
      throw new Error("engine unreachable");
    });
    const client = await freshClient();

    const failed = vi.fn();
    await expect(client.subscribeToOrders(failed)).rejects.toThrow("engine unreachable");
    await client.subscribeToOrders(vi.fn());
    publish(state("retry"));
    failedPublish(state("late failed generation"));
    expect(failed).not.toHaveBeenCalled();

    expect(sdk.subscribeToProjection).toHaveBeenCalledTimes(2);
  });

  test("resubscribes after configure() runs again with new settings", async () => {
    vi.resetModules();
    const { browserIronflow } = await import("@/lib/browser-client");
    await browserIronflow(settings).subscribeToOrders(vi.fn());

    const reconfigured = browserIronflow({ ...settings, apiKey: "ifkey_rotated" });
    await reconfigured.subscribeToOrders(vi.fn());

    expect(sdk.configure).toHaveBeenCalledTimes(2);
    expect(sdk.subscribeToProjection).toHaveBeenCalledTimes(2);
  });
  test("treats repeated callbacks as separate registrations and opens a fresh generation after cleanup", async () => {
    const client = await freshClient();
    const listener = vi.fn();
    const one = await client.subscribeToOrders(listener);
    const two = await client.subscribeToOrders(listener);
    one.unsubscribe();
    publish(state("remaining"));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(sdkUnsubscribe).not.toHaveBeenCalled();
    two.unsubscribe();
    const fresh = await client.subscribeToOrders(vi.fn());
    one.unsubscribe(); two.unsubscribe();
    expect(sdkUnsubscribe).toHaveBeenCalledTimes(1);
    fresh.unsubscribe();
    expect(sdkUnsubscribe).toHaveBeenCalledTimes(2);
  });

  test.each(["resolve", "reject"])("isolates late old promise %s after configure", async (outcome) => {
    vi.resetModules();
    const { browserIronflow } = await import("@/lib/browser-client");
    let resolve!: (sub: { unsubscribe(): void }) => void;
    let reject!: (error: Error) => void;
    sdk.subscribeToProjection.mockImplementationOnce(() => new Promise((yes, no) => { resolve = yes; reject = no; }));
    const oldListener = vi.fn();
    const old = browserIronflow(settings).subscribeToOrders(oldListener);
    const oldResult = expect(old).rejects.toThrow();
    await vi.waitFor(() => expect(sdk.subscribeToProjection).toHaveBeenCalledTimes(1));
    const freshListener = vi.fn();
    const fresh = await browserIronflow({ ...settings, apiKey: "new" }).subscribeToOrders(freshListener);
    const oldUnsubscribe = vi.fn();
    if (outcome === "resolve") resolve({ unsubscribe: oldUnsubscribe });
    else reject(new Error("old failure"));
    await oldResult;
    publish(state("fresh"));
    expect(oldListener).not.toHaveBeenCalled();
    expect(freshListener).toHaveBeenCalledOnce();
    expect(oldUnsubscribe).toHaveBeenCalledTimes(outcome === "resolve" ? 1 : 0);
    expect(sdkUnsubscribe).not.toHaveBeenCalled();
    fresh.unsubscribe();
    expect(sdkUnsubscribe).toHaveBeenCalledOnce();
  });

  test("invalidates a generation configured away before its SDK call starts", async () => {
    vi.resetModules();
    const { browserIronflow } = await import("@/lib/browser-client");
    const old = browserIronflow(settings).subscribeToOrders(vi.fn());
    const rejected = expect(old).rejects.toThrow("canceled by configure");
    const fresh = browserIronflow({ ...settings, apiKey: "new" }).subscribeToOrders(vi.fn());
    await rejected;
    const handle = await fresh;
    expect(sdk.subscribeToProjection).toHaveBeenCalledTimes(1);
    handle.unsubscribe();
    expect(sdkUnsubscribe).toHaveBeenCalledOnce();
  });

});
