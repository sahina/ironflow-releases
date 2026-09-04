// The payment gateway simulator.
//
// It stands in for the one external system this example calls, and it exists to
// make that call *countable*: every side effect is a row, so the crash proof can
// assert "the card was authorized exactly once" against durable evidence rather
// than against a log line.
//
// It is private to this service. Nothing else reads this database, and it is not
// a shared application store — the SQLite file lives under the same `.data/`
// directory `make reference-app-reset` deletes.
//
// node:sqlite, not a native driver: Node 24 ships it, so the example installs no
// compiled dependency and `pnpm install` needs no build allowance.
import { DatabaseSync } from "node:sqlite";

/** What the gateway decided. A decline is permanent; this example never retries. */
export type AuthorizeOutcome =
  | { status: "authorized"; authorizationId: string }
  | { status: "declined"; reason: string };

export type CaptureOutcome = { status: "captured"; captureId: string };

export type AuthorizeInput = {
  /** Derived from the order and the operation, never from process-local randomness. */
  idempotencyKey: string;
  orderId: string;
  amountCents: number;
  currency: string;
  paymentMethodToken: string;
};

export type CaptureInput = {
  idempotencyKey: string;
  orderId: string;
  authorizationId: string;
  amountCents: number;
  currency: string;
};

export type Operation = "authorize" | "capture";

export type Gateway = {
  authorize(input: AuthorizeInput): AuthorizeOutcome;
  capture(input: CaptureInput): CaptureOutcome;
  /** External side effects recorded for one order and operation. */
  callCount(orderId: string, operation: Operation): number;
  /**
   * Repeat presentations of a key the ledger already held.
   *
   * The difference between this and `callCount` is what the crash proof reads:
   * a durable replay that skipped the memoized step never reaches the gateway
   * at all, so it leaves zero here — while a step that really re-ran, and was
   * saved by the idempotency key alone, leaves one.
   */
  dedupHits(orderId: string, operation: Operation): number;
  close(): void;
};

// The scenario table. The demo's three tokens are the whole gateway behaviour
// model; anything else is a programming error, not a decline.
const DECISIONS: Record<string, "authorized" | "declined" | undefined> = {
  pm_success: "authorized",
  // The crash scenario diverges after authorization, not during it.
  pm_crash: "authorized",
  pm_decline: "declined",
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS gateway_calls (
  idempotency_key TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL,
  operation       TEXT NOT NULL,
  payment_token   TEXT NOT NULL,
  result          TEXT NOT NULL,
  request         TEXT NOT NULL,
  call_count      INTEGER NOT NULL,
  dedup_hits      INTEGER NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS gateway_calls_by_order ON gateway_calls (order_id, operation);
`;

/** Open (and create) the gateway database at `path`. */
export function openGateway(path: string): Gateway {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  // The live gate and the crash proof open this file read-only while the worker
  // is writing to it. WAL lets them read concurrently, but a checkpoint can
  // still collide — without a timeout that surfaces as an immediate SQLITE_BUSY
  // and fails a step for a reason that has nothing to do with payments.
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(SCHEMA);
  // A ledger written before dedup_hits existed would make every prepare below
  // fail, and the presenter would see only "payments exited before it was
  // ready". One idempotent ALTER is cheaper than that, and keeps the evidence.
  const columns = db.prepare("PRAGMA table_info(gateway_calls)").all() as { name: string }[];
  const has = (name: string) => columns.some((column) => column.name === name);
  if (!has("dedup_hits")) {
    db.exec("ALTER TABLE gateway_calls ADD COLUMN dedup_hits INTEGER NOT NULL DEFAULT 0");
  }
  if (!has("request")) {
    db.exec("ALTER TABLE gateway_calls ADD COLUMN request TEXT NOT NULL DEFAULT ''");
  }

  const find = db.prepare("SELECT result, request FROM gateway_calls WHERE idempotency_key = ?");
  const insert = db.prepare(
    `INSERT INTO gateway_calls
       (idempotency_key, order_id, operation, payment_token, result, request, call_count, dedup_hits, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
  );
  const noteRepeat = db.prepare(
    "UPDATE gateway_calls SET dedup_hits = dedup_hits + 1, updated_at = ? WHERE idempotency_key = ?",
  );
  const totals = db.prepare(
    `SELECT COALESCE(SUM(call_count), 0) AS calls, COALESCE(SUM(dedup_hits), 0) AS hits
       FROM gateway_calls WHERE order_id = ? AND operation = ?`,
  );

  // One place for both operations: a stored decision always wins, and only a key
  // the table has never seen becomes a real side effect.
  function record<T>(
    key: string,
    orderId: string,
    operation: Operation,
    token: string,
    request: string,
    decide: () => T,
  ): T {
    const stored = find.get(key) as { result?: string; request?: string } | undefined;
    if (stored?.result !== undefined) {
      // An idempotency key is a promise that the request behind it is the same
      // request. A real gateway that returns a stored approval for a key
      // presented with a different amount has just been used to move the wrong
      // money — so this refuses instead of silently replaying.
      if (stored.request !== "" && stored.request !== request) {
        throw new Error(
          `idempotency key ${key} was reused with different parameters: stored ${stored.request}, presented ${request}`,
        );
      }
      noteRepeat.run(new Date().toISOString(), key);
      return JSON.parse(stored.result) as T;
    }

    const outcome = decide();
    const now = new Date().toISOString();
    insert.run(key, orderId, operation, token, JSON.stringify(outcome), request, now, now);
    return outcome;
  }

  /** Everything about a call that must not change between presentations of a key. */
  const fingerprint = (parts: (string | number)[]) => parts.join("|");

  return {
    authorize(input) {
      const request = fingerprint([
        "authorize", input.orderId, input.amountCents, input.currency, input.paymentMethodToken,
      ]);
      return record(input.idempotencyKey, input.orderId, "authorize", input.paymentMethodToken, request, () => {
        const decision = DECISIONS[input.paymentMethodToken];
        if (!decision) {
          throw new Error(
            `unknown payment method token ${input.paymentMethodToken} — the demo defines pm_success, pm_decline and pm_crash`,
          );
        }
        return decision === "authorized"
          ? { status: "authorized", authorizationId: `auth_${input.orderId}` }
          : { status: "declined", reason: "card_declined" };
      });
    },

    capture(input) {
      const request = fingerprint([
        "capture", input.orderId, input.authorizationId, input.amountCents, input.currency,
      ]);
      return record(input.idempotencyKey, input.orderId, "capture", "", request, () => ({
        status: "captured",
        captureId: `cap_${input.orderId}`,
      }));
    },

    callCount(orderId, operation) {
      return Number((totals.get(orderId, operation) as { calls: number }).calls);
    },

    dedupHits(orderId, operation) {
      return Number((totals.get(orderId, operation) as { hits: number }).hits);
    },

    close() {
      db.close();
    },
  };
}
