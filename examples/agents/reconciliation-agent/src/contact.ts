import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineTool } from "@ironflow/node/agent";
import { z } from "zod";
import { ACTION_LABEL, CAUSE_LABEL } from "./causes.js";
import type { Triage } from "./llm.js";

// ── Why the key goes TO the provider ───────────────────────────
//
// step.run memoization protects a step that COMPLETED. Crash after the
// provider accepted the message but before the step result persisted, and
// the resumed run sends again. tool({idempotency:"byArgs"}) hashes the args
// — still local memoization, still blind to that window.
//
// So the key is derived deterministically from (runId, decisionId) and the
// PROVIDER dedupes on it. That is the only version where killing mid-send
// leaves exactly one delivery.
// ────────────────────────────────────────────────────────────────

export function contactKey(runId: string, decisionId: string): string {
  return createHash("sha256").update(`${runId}:${decisionId}`).digest("hex").slice(0, 24);
}

export interface Delivery {
  key: string;
  caseId: string;
  body: string;
}

// ── Why the ledger is a FILE ───────────────────────────────────
//
// An in-process Set cannot prove anything about a crash: kill -9 destroys
// the delivery log along with the worker, and the restarted process starts
// empty and happily sends again. Worse, the demo would then PASS — an empty
// ledger reports one delivery either way.
//
// A real provider dedupes server-side, across processes, and its record
// outlives your worker. The file models exactly that property, and it is
// what makes scripts/demo-crash-resume.sh a real assertion instead of a
// tautology.
// ────────────────────────────────────────────────────────────────

const LEDGER =
  process.env.CONTACT_LEDGER ?? fileURLToPath(new URL("../.contact-ledger.jsonl", import.meta.url));

// Simulated provider latency. The crash demo kills the worker DURING this
// window — after the provider has accepted, before the step result persists.
// That is the only window where memoization alone lets a second send through.
// A mis-set value (e.g. a stray unit suffix like "500ms") would coerce to
// NaN and silently drop the window, so the crash demo would pass while
// proving nothing — fail loudly instead of coercing.
const rawSendMs = process.env.CONTACT_SEND_MS;
const SEND_MS = rawSendMs === undefined ? 0 : Number(rawSendMs);
if (!Number.isFinite(SEND_MS) || SEND_MS < 0) {
  throw new Error(`CONTACT_SEND_MS has to be a finite number, zero or more — got ${JSON.stringify(rawSendMs)}`);
}

export class FixtureProvider {
  private read(): Delivery[] {
    if (!existsSync(LEDGER)) return [];
    return readFileSync(LEDGER, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as Delivery);
  }

  get deliveries(): Delivery[] {
    return this.read();
  }

  async send(key: string, caseId: string, body: string): Promise<{ deduped: boolean }> {
    // TOCTOU ceiling: read-then-append is check-then-act, so two truly
    // concurrent calls with the same key could both pass this check.
    // Unreachable under this plan's usage (one send-contact call per case,
    // one live lease per run) — a real provider dedupes atomically
    // server-side, which this file-backed fixture does not model.
    if (this.read().some((d) => d.key === key)) return { deduped: true };

    // Record BEFORE the latency window: the provider has accepted at this
    // point, which is precisely what a crash must not be able to undo.
    appendFileSync(LEDGER, JSON.stringify({ key, caseId, body }) + "\n");
    if (SEND_MS > 0) await new Promise((r) => setTimeout(r, SEND_MS));
    return { deduped: false };
  }

  reset(): void {
    writeFileSync(LEDGER, "");
  }
}

export const provider = new FixtureProvider();

export function draftMessage(caseId: string, counterparty: string, triage: Triage): string {
  const cause = CAUSE_LABEL[triage.classification];
  const action = ACTION_LABEL[triage.proposedActionId] ?? triage.proposedActionId;
  return [
    `Re: reconciliation case ${caseId}`,
    ``,
    `Hello ${counterparty},`,
    ``,
    `Our records and your statement disagree for this period. Our reading is`,
    `that this looks like ${cause}, and we propose to ${action}.`,
    ``,
    `Could you confirm or correct that?`,
  ].join("\n");
}

export const sendContact = defineTool({
  name: "send-contact",
  description: "Send the approved outbound message. Deduped provider-side on the idempotency key.",
  input: z.object({ key: z.string(), caseId: z.string(), body: z.string() }),
  handler: async ({ key, caseId, body }) => provider.send(key, caseId, body),
});
