import { describe, expect, it } from "vitest";
import { confirmedActionFor } from "../src/agent.js";
import { ACTIONS } from "../src/causes.js";
import type { ResolutionSignal } from "../src/events.js";

// Criterion 4: the model proposes, a person or a rule authorizes. These
// assert the one branch that makes that true — an unclear reply must never
// resolve a case, and only an allowlisted, classified reply may.
describe("confirmedActionFor", () => {
  it("does not confirm an action when the reply is unclear", () => {
    const signal: ResolutionSignal = { caseId: "case-1", kind: "reply", replyClassification: "unclear" };
    expect(confirmedActionFor(signal)).toBeNull();
  });

  it("does not confirm an action when replyClassification is missing", () => {
    const signal: ResolutionSignal = { caseId: "case-1", kind: "reply", confirmedActionId: ACTIONS[0] };
    expect(confirmedActionFor(signal)).toBeNull();
  });

  it("does not confirm an action when confirmedActionId is off the allowlist", () => {
    const signal: ResolutionSignal = {
      caseId: "case-1",
      kind: "reply",
      replyClassification: "posted-elsewhere",
      confirmedActionId: "delete-everything",
    };
    expect(confirmedActionFor(signal)).toBeNull();
  });

  it("does not confirm an action when confirmedActionId is missing", () => {
    const signal: ResolutionSignal = { caseId: "case-1", kind: "reply", replyClassification: "posted-elsewhere" };
    expect(confirmedActionFor(signal)).toBeNull();
  });

  it("confirms the action when classified and allowlisted", () => {
    const signal: ResolutionSignal = {
      caseId: "case-1",
      kind: "reply",
      replyClassification: "posted-elsewhere",
      confirmedActionId: ACTIONS[0],
    };
    expect(confirmedActionFor(signal)).toBe(ACTIONS[0]);
  });
});
