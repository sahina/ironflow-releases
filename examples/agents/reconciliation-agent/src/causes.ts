// The closed set of reasons a transaction can fail deterministic matching.
//
// Three consumers read this list: the fixture generator (which seeds the
// residue), the fake classifier in llm.ts (which picks among them), and the
// allowlist that validates the model's proposedActionId. If they drift, the
// example still passes its tests while teaching something false — so
// tests/fixtures.test.ts asserts all three agree.

export const CAUSES = [
  "posted-to-sibling-account",
  "timing-next-period",
  "partial-payment",
  "fee-deducted-at-source",
  "duplicate-posting",
] as const;

export type Cause = (typeof CAUSES)[number];

export const ACTION_FOR_CAUSE: Record<Cause, string> = {
  "posted-to-sibling-account": "reassign-to-sibling",
  "timing-next-period": "defer-to-next-period",
  "partial-payment": "record-partial",
  "fee-deducted-at-source": "record-fee",
  "duplicate-posting": "void-duplicate",
};

export const ACTIONS = Object.values(ACTION_FOR_CAUSE) as readonly string[];

// Human-readable phrasing for the approval UI and the outbound message —
// the enum ids above are for the model and the allowlist, not for a person
// reading a draft before it goes out.
export const CAUSE_LABEL: Record<Cause, string> = {
  "posted-to-sibling-account": "posted to a sibling account",
  "timing-next-period": "a timing difference that will resolve next period",
  "partial-payment": "a partial payment",
  "fee-deducted-at-source": "a fee deducted at source",
  "duplicate-posting": "a duplicate posting",
};

export const ACTION_LABEL: Record<string, string> = {
  "reassign-to-sibling": "reassign it to the sibling account",
  "defer-to-next-period": "defer it to the next period",
  "record-partial": "record it as a partial payment",
  "record-fee": "record the fee",
  "void-duplicate": "void the duplicate",
};
