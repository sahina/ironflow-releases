import { describe, expect, test } from "vitest";

import { dashboardRunUrl, dashboardStreamUrl } from "@/lib/dashboard-links";

describe("links into the Ironflow dashboard", () => {
  test("points at the run that produced an event", () => {
    // The dashboard's real route. This UI links to the run inspector rather
    // than rebuilding one — see the non-goals in CONTEXT-MAP.md.
    expect(dashboardRunUrl("http://127.0.0.1:49152", "run_01H8")).toBe(
      "http://127.0.0.1:49152/runs/run_01H8",
    );
  });

  test("points at each of an order's two entity streams", () => {
    // The UI knows order ids; each stream is named the way the service that
    // writes it names it, and each mapping lives in one place. Ordering owns
    // `order-{id}` and Payments owns `payment-{id}`.
    expect(
      dashboardStreamUrl("http://127.0.0.1:49152", "0f3b6c1d9a4e47b28c5d1e6f70a2b3c4", "order"),
    ).toBe("http://127.0.0.1:49152/streams/order-0f3b6c1d9a4e47b28c5d1e6f70a2b3c4");
    expect(
      dashboardStreamUrl("http://127.0.0.1:49152", "0f3b6c1d9a4e47b28c5d1e6f70a2b3c4", "payment"),
    ).toBe("http://127.0.0.1:49152/streams/payment-0f3b6c1d9a4e47b28c5d1e6f70a2b3c4");
  });

  test("survives a base URL with a trailing slash", () => {
    // NEXT_PUBLIC_IRONFLOW_URL comes from the supervisor, and a presenter who
    // sets it by hand will type the slash.
    expect(dashboardRunUrl("http://127.0.0.1:49152/", "run_01H8")).toBe(
      "http://127.0.0.1:49152/runs/run_01H8",
    );
  });
});
