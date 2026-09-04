import { beforeEach, describe, expect, test } from "vitest";

import { currentDemoSession, startNewDemoSession } from "@/lib/session";

describe("the demo session", () => {
  beforeEach(() => localStorage.clear());

  test("is one safe entity id, stable across reloads", () => {
    const first = currentDemoSession();

    // Reading it again is what a reload does: same browser storage, new module
    // call. The id must survive, because it is the filter the whole UI applies.
    expect(currentDemoSession()).toBe(first);
    // The shape contracts/schemas/common.v1.schema.json calls an entityId.
    expect(first).toMatch(/^[0-9a-f]{32}$/);
  });

  test("a new session replaces the old one without touching history", () => {
    const first = currentDemoSession();

    const next = startNewDemoSession();

    expect(next).not.toBe(first);
    expect(currentDemoSession()).toBe(next);
  });
});
