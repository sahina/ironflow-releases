// The Payments context of the reference app.
//
// A pull-mode Ironflow worker: it polls the engine for work, so it needs no
// inbound port and no HTTP API of its own. The supervisor
// (examples/reference-app/scripts/dev.mjs) starts it with IRONFLOW_URL,
// IRONFLOW_API_KEY and REFERENCE_APP_DATA_DIR already pointing at the engine and
// data directory it just created.
//
// This file is the wiring. The decisions live in payment.ts, the countable side
// effect in gateway.ts, and the shared wire contract in contracts.ts.
import { join } from "node:path";

import { ConflictError, createClient, ironflow, type IronflowClient } from "@ironflow/node";
import { createWorker } from "@ironflow/node/worker";

import { findContractsDir, loadDataSchema, OWNED_SCHEMAS } from "./contracts.js";
import { openGateway, type Gateway } from "./gateway.js";
import {
  decideAuthorized,
  decideCaptured,
  decideDeclined,
  ENTITY_TYPE,
  EVENT_DEMO_CONTINUE,
  EVENT_ORDER_RELEASED,
  fold,
  mayAuthorize,
  mayCapture,
  needsPresenterRelease,
  parseReleased,
  PRODUCER,
  streamId,
  type Append,
  type Fact,
  type PaymentState,
  type Released,
} from "./payment.js";

/** Function and step IDs. The crash proof reads the step names off a run. */
export const FN_PROCESS_PAYMENT = "process-payment";
export const STEP_AUTHORIZE = "authorize";
export const STEP_WAIT_CONTINUE = "wait-presenter-continue";
export const STEP_CAPTURE = "capture";

/**
 * Bounds the crash-scenario wait. A presenter who wanders off does not hold a
 * run open forever, and the value matches the ordering service's approval wait.
 */
export const CONTINUE_WAIT_TIMEOUT = "7d";

/**
 * The payment stream, from this context's point of view.
 *
 * Payments is the sole writer of `payment-{orderId}`; nothing here can reach an
 * order stream. Keeping it an interface is what lets the step bodies be
 * exercised against a fake and the expected versions asserted without a server.
 */
export type Streams = {
  read(orderId: string): Promise<Fact[]>;
  append(orderId: string, append: Append, metadata: Record<string, unknown>): Promise<number>;
};

export function clientStreams(client: IronflowClient): Streams {
  return {
    async read(orderId) {
      const { events } = await client.streams.read(streamId(orderId));
      return events.map((event) => ({
        name: event.name,
        data: event.data ?? {},
        entityVersion: event.entityVersion,
      }));
    },
    async append(orderId, append, metadata) {
      const result = await client.streams.append(
        streamId(orderId),
        { name: append.name, data: append.data, entityType: ENTITY_TYPE },
        {
          expectedVersion: append.expectedVersion,
          idempotencyKey: append.idempotencyKey,
          metadata,
        },
      );
      return result.entityVersion;
    },
  };
}

/** The metadata every fact this service writes carries. */
export function factMetadata(orderId: string, causationId: string, demoSessionId: string): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    correlationId: orderId,
    causationId,
    producer: PRODUCER,
  };
  if (demoSessionId) metadata.demoSessionId = demoSessionId;
  return metadata;
}

export function demoSessionOf(metadata: Record<string, unknown> | undefined): string {
  const session = metadata?.demoSessionId;
  return typeof session === "string" ? session : "";
}

export type Deps = {
  streams: Streams;
  gateway: Gateway;
  /** Injectable so tests get deterministic timestamps. */
  now?: () => Date;
};

const at = (deps: Deps) => (deps.now?.() ?? new Date()).toISOString();

/**
 * Writes one decided fact, treating a version conflict as already done only
 * once it has proved that is what happened.
 *
 * A run that crashed between the append and the step's checkpoint replays this
 * body and finds the stream already moved. That is success — the fact it wanted
 * to write is the fact on the stream. But "the stream moved" and "my fact won"
 * are different claims, and a conflict alone supports only the first. Swallowing
 * every conflict would checkpoint an unrelated append, or a decline where an
 * authorization was intended, as a success this run then builds on.
 */
async function appendOnce(
  deps: Deps,
  orderId: string,
  append: Append | undefined,
  causationId: string,
  session: string,
): Promise<void> {
  if (!append) return;
  try {
    // audit-ignore: missing-expectedversion — this is the Streams port, not the
    // SDK. The version is on `append`, decided by the domain, and clientStreams
    // above passes it to client.streams.append.
    await deps.streams.append(orderId, append, factMetadata(orderId, causationId, session));
  } catch (error) {
    if (!(error instanceof ConflictError)) throw error;
    const facts = await deps.streams.read(orderId);
    if (!facts.some((fact) => fact.name === append.name)) {
      throw new Error(
        `${append.name} for ${orderId} lost a version conflict to something else: the stream holds ` +
          `[${facts.map((fact) => fact.name).join(", ")}]`,
      );
    }
  }
}

export type AuthorizeResult =
  | { status: "authorized"; authorizationId: string }
  | { status: "declined"; reason: string };

/**
 * The authorize step: read, decide, then one gateway call and the fact that
 * records it.
 *
 * Read and decide come first. Calling the external system before asking the
 * domain whether to means a duplicated trigger touches the gateway before
 * anything can stop it, and leaves the code with a hold it has already taken
 * when it finds out it should not have.
 *
 * Call and append stay one step on purpose. If the gateway succeeds and the
 * append fails, the retry re-presents the same idempotency key and the gateway
 * returns the stored decision rather than holding the card twice — which is the
 * whole reason the key is derived from the order and not from this process.
 */
export async function authorizeStep(
  deps: Deps,
  released: Released,
  causationId: string,
  session: string,
): Promise<AuthorizeResult> {
  const before = fold(await deps.streams.read(released.orderId));
  if (!mayAuthorize(before)) {
    // The attempt is already on the stream. Replay it from the ledger rather
    // than from the gateway: presenting the key again would be harmless, but
    // "the replay never called the gateway" is what the crash proof asserts.
    return replayAuthorization(before);
  }

  const outcome = deps.gateway.authorize({
    idempotencyKey: `authorize:${released.orderId}`,
    orderId: released.orderId,
    amountCents: released.totalCents,
    currency: released.currency,
    paymentMethodToken: released.paymentMethodToken,
  });

  const state = fold(await deps.streams.read(released.orderId));
  const append =
    outcome.status === "authorized"
      ? decideAuthorized(state, released, outcome.authorizationId, at(deps))
      : decideDeclined(state, released, outcome.reason, at(deps));
  if (!append) {
    // The attempt landed while this step was at the gateway. The stream is
    // authoritative and this step's own outcome is not: returning the gateway's
    // answer here would let a run whose stream says `payment.declined` walk on
    // to capture a card it never held.
    return replayAuthorization(state);
  }
  await appendOnce(deps, released.orderId, append, causationId, session);

  return outcome;
}

/** The outcome already recorded on the payment stream, read back as a result. */
function replayAuthorization(state: PaymentState): AuthorizeResult {
  if (state.authorized) {
    return { status: "authorized", authorizationId: state.authorizationId };
  }
  return { status: "declined", reason: state.declineReason };
}

/**
 * The capture step. Only this fact can let Ordering mark the order paid.
 *
 * Read and decide come first, for a sharper reason than in authorize: capturing
 * a payment that was never authorized is a caller bug, and discovering it after
 * the gateway call means the card has been charged for an order this service
 * will then refuse to mark captured. `mayCapture` throws before any money moves.
 */
export async function captureStep(
  deps: Deps,
  released: Released,
  authorizationId: string,
  causationId: string,
  session: string,
): Promise<{ status: "captured"; captureId: string }> {
  const before = fold(await deps.streams.read(released.orderId));
  if (!mayCapture(before, released.orderId)) {
    return { status: "captured", captureId: before.captureId };
  }

  const outcome = deps.gateway.capture({
    idempotencyKey: `capture:${released.orderId}`,
    orderId: released.orderId,
    authorizationId,
    amountCents: released.totalCents,
    currency: released.currency,
  });

  const state = fold(await deps.streams.read(released.orderId));
  const append = decideCaptured(state, released, authorizationId, outcome.captureId, at(deps));
  if (!append) {
    // Same reconciliation as authorize: the capture landed while this step was
    // at the gateway, so the recorded id wins over this step's own.
    return { status: "captured", captureId: state.captureId };
  }
  await appendOnce(deps, released.orderId, append, causationId, session);

  return outcome;
}

/**
 * The one payment function: one attempt per order, two durable steps.
 *
 * The `pm_crash` token parks the run on a durable wait between them. That is
 * what makes the crash demonstration safe to present: a parked run holds no
 * worker claim, so killing the worker costs nothing and the restarted one
 * resumes from the memoized authorization instead of calling the gateway again.
 */
export function paymentFunction(deps: Deps) {
  return ironflow.createFunction(
    {
      id: FN_PROCESS_PAYMENT,
      name: "Process payment",
      mode: "pull",
      recording: true,
      triggers: [{ event: EVENT_ORDER_RELEASED }],
    },
    async ({ event, step }) => {
      const released = parseReleased(event.data);
      const session = demoSessionOf(event.metadata);

      const authorized = await step.run(STEP_AUTHORIZE, () =>
        authorizeStep(deps, released, event.id, session),
      );
      // A decline is final. No retry, no second attempt, no compensation.
      if (authorized.status === "declined") return authorized;

      if (needsPresenterRelease(released.paymentMethodToken)) {
        // Match on data.orderId: the engine compares this run's triggering
        // order.released with each incoming demo.payment.continue, so one
        // waiting run belongs to exactly one order.
        await step.waitForEvent(STEP_WAIT_CONTINUE, {
          event: EVENT_DEMO_CONTINUE,
          match: "data.orderId",
          timeout: CONTINUE_WAIT_TIMEOUT,
        });
      }

      return step.run(STEP_CAPTURE, () =>
        captureStep(deps, released, authorized.authorizationId, event.id, session),
      );
    },
  );
}

/**
 * Registration is idempotent: re-registering the same version with the same
 * document is an upsert, so a restart — and a presenter's crash — is free.
 */
async function registerSchemas(client: IronflowClient, contractsDir: string): Promise<void> {
  for (const name of OWNED_SCHEMAS) {
    // audit-ignore: upcaster-drops-fields — not an upcaster. This example has
    // one schema version and no version boundary to carry fields across.
    await client.schemas.register({ name, version: 1, schema: loadDataSchema(contractsDir, name) });
  }
}

function dataDir(): string {
  const dir = process.env.REFERENCE_APP_DATA_DIR;
  if (!dir) throw new Error("REFERENCE_APP_DATA_DIR is unset — start the example with `make reference-app`");
  return dir;
}

async function main(): Promise<void> {
  const contractsDir = findContractsDir();
  const client = createClient({});

  // Registration comes before the worker starts, so the first released order
  // cannot race an unregistered schema.
  await registerSchemas(client, contractsDir);

  const gateway = openGateway(join(dataDir(), "payments-gateway.db"));
  const worker = createWorker({
    functions: [paymentFunction({ streams: clientStreams(client), gateway })],
    // 3s, not the 30s default: /operations shows the worker leaving and
    // returning from heartbeat freshness, and a 30s gap would make the crash
    // demonstration look like a hang. More frequent heartbeats are free.
    heartbeatInterval: 3_000,
  });

  const stop = () => {
    process.stderr.write("stopping\n");
    void worker.drain().finally(() => {
      gateway.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  process.stdout.write(`payments ready — ${OWNED_SCHEMAS.length} schemas registered\n`);
  await worker.start();
}

// import.meta.main, not an argv[1] comparison: argv[1] is the path as typed
// while import.meta.url is realpath'd, so behind a symlinked checkout the
// comparison is false and the process exits 0 having done nothing.
if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(`payments: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
