import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { IronflowProvider } from "@/components/ironflow-provider";
import { System } from "@/components/system";
import { fakeIronflow } from "@/test/fake-ironflow";

function renderSystem() {
  render(
    <IronflowProvider client={fakeIronflow()}>
      <System dashboardUrl="http://127.0.0.1:49152" readModelConnected={true} />
    </IronflowProvider>,
  );
}

describe("the system page", () => {
  test("names every process and the language it is written in", () => {
    renderSystem();

    const status = screen.getByRole("list", { name: "Right now" });
    expect(status).toHaveTextContent("Python");
    expect(status).toHaveTextContent("Go");
    expect(status).toHaveTextContent("TypeScript");
  });

  test("links each service to its own source directory", () => {
    // "Discover how it works through the UI and nearby source" is the point of
    // the page; a status light with no way into the code misses it.
    renderSystem();

    // The whole URL, not a substring: a wrong repository root or a missing
    // `examples/reference-app` segment still contains the path.
    const base = "https://github.com/sahina/ironflow/tree/main/examples/reference-app";
    for (const path of [
      "services/orders-go",
      "services/payments-node",
      "services/notifications-python",
      "apps/web",
    ]) {
      expect(screen.getByRole("link", { name: path })).toHaveAttribute("href", `${base}/${path}`);
    }
    expect(screen.getByRole("link", { name: "the Ironflow engine" })).toHaveAttribute(
      "href",
      "https://github.com/sahina/ironflow/tree/main",
    );
  });

  test("says the services never call each other over business HTTP", () => {
    // The single most load-bearing claim about this architecture.
    renderSystem();

    expect(screen.getByRole("region", { name: "System" })).toHaveTextContent(/never call each other/i);
  });
});
