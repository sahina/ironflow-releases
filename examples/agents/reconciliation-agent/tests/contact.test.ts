import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The provider reads CONTACT_LEDGER at module load, so set it before the
// import resolves. Each run gets its own file — the committed ledger is
// never touched by the suite.
process.env.CONTACT_LEDGER = join(mkdtempSync(join(tmpdir(), "contact-")), "ledger.jsonl");
const { contactKey, draftMessage, provider } = await import("../src/contact.js");
const { ACTION_LABEL } = await import("../src/causes.js");

beforeEach(() => provider.reset());

describe("the idempotency key", () => {
  it("is deterministic across replays of the same decision", () => {
    expect(contactKey("run-1", "case-a")).toBe(contactKey("run-1", "case-a"));
  });

  it("differs per run and per decision", () => {
    expect(contactKey("run-1", "case-a")).not.toBe(contactKey("run-2", "case-a"));
    expect(contactKey("run-1", "case-a")).not.toBe(contactKey("run-1", "case-b"));
  });
});

describe("the provider dedupes on the key", () => {
  // This is the half of criterion 3 that runs in `make ci`. The other half —
  // a real worker killed mid-send — is scripts/demo-crash-resume.sh, in
  // ci-full. Neither proves the criterion alone.
  it("delivers once when the same key is sent twice", async () => {
    const key = contactKey("run-1", "case-a");
    const first = await provider.send(key, "case-a", "hello");
    const second = await provider.send(key, "case-a", "hello");

    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(provider.deliveries).toHaveLength(1);
  });

  it("delivers twice for two different decisions", async () => {
    await provider.send(contactKey("run-1", "case-a"), "case-a", "hello");
    await provider.send(contactKey("run-1", "case-b"), "case-b", "hello");
    expect(provider.deliveries).toHaveLength(2);
  });
});

describe("the draft the approver reads", () => {
  it("names the case and the proposed action in plain language", () => {
    const draft = draftMessage("case-a", "Vendor A", {
      classification: "fee-deducted-at-source",
      confidence: 0.82,
      proposedActionId: "record-fee",
    });
    expect(draft).toContain("case-a");
    expect(draft).toContain("Vendor A");
    expect(draft).toContain(ACTION_LABEL["record-fee"]);
    expect(draft).not.toContain("record-fee");
    expect(draft).not.toContain("fee-deducted-at-source");
  });
});
