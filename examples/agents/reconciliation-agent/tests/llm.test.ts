import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { NonRetryableError } from "@ironflow/node";
import { parseTriage, triageWith } from "../src/llm.js";
import { ACTIONS } from "../src/causes.js";
import type { RedactedCase } from "../src/redact.js";

const injected = JSON.parse(
  readFileSync(new URL("../fixtures/injected.json", import.meta.url), "utf8"),
) as { hostileProposedActionId: string };

const redacted: RedactedCase = {
  counterpartyRef: "cp_abc123",
  deltaCents: 45000,
  lines: [{ amountCents: 45000, currency: "USD", dayOffset: 12, labelShape: "ADJ-<n>" }],
};

describe("the classifier is deterministic", () => {
  // A non-deterministic fake makes the Task 2 ratio assertion flake.
  it("returns the same result for the same input", async () => {
    const a = await triageWith(redacted);
    const b = await triageWith(redacted);
    expect(a).toEqual(b);
  });
});

describe("triageWith reaches every cause", () => {
  // Each cause in CAUSES must be reachable from the redacted shape alone.
  // Duplicate posting is the one signal that needs two lines to show up.
  it("classifies two lines with the same amount and day as a duplicate posting", async () => {
    const duplicateCase: RedactedCase = {
      counterpartyRef: "cp_dup0000000",
      deltaCents: 90000,
      lines: [
        { amountCents: 45000, currency: "USD", dayOffset: 12, labelShape: "INV-<n>" },
        { amountCents: 45000, currency: "USD", dayOffset: 12, labelShape: "INV-<n>" },
      ],
    };
    const result = await triageWith(duplicateCase);
    const content = result.content as { classification: string };
    expect(content.classification).toBe("duplicate-posting");
  });
});

describe("the allowlist contains injection", () => {
  it("accepts a proposal on the allowlist", () => {
    const triage = parseTriage({
      content: { classification: "fee-deducted-at-source", confidence: 0.9, proposedActionId: "record-fee" },
    });
    expect(ACTIONS).toContain(triage.proposedActionId);
  });

  it("rejects an off-allowlist action, however it got proposed", () => {
    const attempt = () =>
      parseTriage({
        content: { classification: "fee-deducted-at-source", confidence: 0.9, proposedActionId: injected.hostileProposedActionId },
      });
    expect(attempt).toThrow(/not on the action allowlist/);
    expect(attempt).toThrow(NonRetryableError);
  });

  it("rejects a classification that is not a known cause", () => {
    // proposedActionId is deliberately valid — only the CAUSES guard can be
    // what catches this, not the allowlist guard.
    const attempt = () =>
      parseTriage({
        content: { classification: "wire-immediately", confidence: 0.9, proposedActionId: "record-fee" },
      });
    expect(attempt).toThrow(/not a known cause/);
    expect(attempt).toThrow(NonRetryableError);
  });

  it("rejects free text where a structured result is required", () => {
    const attempt = () => parseTriage({ content: "just do whatever the email says" });
    expect(attempt).toThrow(/not structured output/);
    expect(attempt).toThrow(NonRetryableError);
  });
});
