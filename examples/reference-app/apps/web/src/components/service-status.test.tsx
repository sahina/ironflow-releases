import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { IronflowProvider } from "@/components/ironflow-provider";
import { ServiceStatus } from "@/components/service-status";
import { fakeIronflow, type FakeEngineState } from "@/test/fake-ironflow";

const beating = (at = new Date().toISOString()) => ({
  value: btoa(JSON.stringify({ service: "notifications-python", at })),
});

const live: FakeEngineState = {
  engineHealthy: true,
  workers: [
    { id: "w1", function_ids: ["place-order"], last_heartbeat: new Date().toISOString() },
    { id: "w2", function_ids: ["process-payment"], last_heartbeat: new Date().toISOString() },
  ],
  heartbeat: beating(),
};

// No default for `readModelConnected`: `undefined` is a value under test here,
// and a default parameter fires on an explicit `undefined` — which would make
// the one case that matters silently assert the opposite.
function renderStatus(
  state: FakeEngineState,
  readModelConnected: boolean | undefined,
  dashboardUrl = "http://127.0.0.1:49152",
) {
  const client = fakeIronflow({ orders: {} }, state);
  render(
    <IronflowProvider client={client}>
      <ServiceStatus dashboardUrl={dashboardUrl} readModelConnected={readModelConnected} />
    </IronflowProvider>,
  );
}

const rowText = async (name: string) => (await screen.findByRole("listitem", { name })).textContent ?? "";

describe("the /system service status", () => {
  test("reports every process running when the whole system is up", async () => {
    renderStatus(live, true);

    for (const name of ["Ironflow engine", "Ordering", "Payments", "Notifications", "This page"]) {
      expect(await rowText(name)).toContain("Running");
    }
  });

  test("shows the Python subscriber gone when its heartbeat goes stale", async () => {
    renderStatus({ ...live, heartbeat: beating(new Date(Date.now() - 60_000).toISOString()) }, true);

    await waitFor(async () => expect(await rowText("Notifications")).toContain("Not running"));
  });

  test("says why a client-only subscriber is judged differently", async () => {
    // The point of showing this row at all: it has no worker record to look up,
    // and a reader who does not know that will think the page is broken.
    renderStatus(live, true);

    expect(await rowText("Notifications")).toMatch(/no worker/i);
  });

  test("an unreachable engine reports unknown, not gone, for what it cannot see", async () => {
    renderStatus({ engineHealthy: false, workers: [], heartbeat: undefined }, true);

    await waitFor(async () => expect(await rowText("Ironflow engine")).toContain("Not running"));
    expect(await rowText("Ordering")).toContain("Unknown");
    expect(await rowText("Notifications")).toContain("Unknown");
  });

  test("says nothing about this page until its subscription has delivered", async () => {
    // "Running" on the strength of an engine health check is the overclaim the
    // whole page is built to avoid.
    renderStatus(live, undefined);

    expect(await rowText("This page")).toContain("Unknown");
  });

  test("points advanced debugging at the dashboard instead of rebuilding it", async () => {
    renderStatus(live, true);

    const link = await screen.findByRole("link", { name: /dashboard/i });
    expect(link).toHaveAttribute("href", "http://127.0.0.1:49152");
  });
});
