// Fraud Detection Pipeline
//
// This worker evaluates every authorized transaction for fraud risk.
// It demonstrates "Continuous History" — Ironflow's approach to capturing
// every state change automatically so you can inspect, replay, and audit
// the full reasoning chain behind every decision.
//
// Key concepts used:
//   - Functions:       Durable workflows triggered by events
//   - step.parallel(): Run multiple checks simultaneously
//   - Entity Streams:  Append-only log per transaction (the "continuous history")
//   - KV Store:        Fast counters for velocity tracking (replaces Redis)
//   - Pub/Sub:         Publish alerts to downstream consumers
//   - Projections:     Real-time aggregates updated as events flow
//   - Recording:       Enables the Inspector for time-travel debugging

import {
  createFunction,
  createProjection,
  createWorker,
  createClient,
  type IronflowProjection,
} from "@ironflow/node";
import { EVENTS, STREAM_EVENTS } from "./events";

// ── Types ───────────────────────────────────────────────────────
// The shape of a transaction event as it arrives from the card network.

interface TransactionEvent {
  txnId: string;
  cardId: string;
  amount: number;
  currency: string;
  merchantName: string;
  merchantMcc: string;       // Merchant Category Code (e.g. "7995" = gambling)
  merchantCountry: string;   // Where the merchant is located
  cardCountry: string;       // Where the card was issued
  ipCountry: string;         // Where the cardholder is connecting from
  deviceFingerprint: string;
  isKnownDevice: boolean;    // Has this device been seen before?
  channel: "pos" | "online" | "contactless";
}

// Each signal check returns a name, its raw value, and how much risk it adds.
interface SignalResult {
  name: string;
  value: number | string | boolean;
  riskContribution: number;  // 0.0 = no risk, up to 0.35 = high risk
}

interface FraudDecision {
  txnId: string;
  action: "approve" | "decline" | "challenge";
  score: number;
  modelVersion: string;
  signals: SignalResult[];
  reason: string;
}

// ── Configuration ───────────────────────────────────────────────
// These would come from Ironflow Config in production so product
// teams can update thresholds without a deploy. Hardcoded here
// for demo clarity.

const MODEL_VERSION = "fraud_v4.2";
const SCORE_THRESHOLD_DECLINE = 0.5;    // Score >= 0.5 → decline
const SCORE_THRESHOLD_CHALLENGE = 0.15; // Score >= 0.15 → challenge (e.g. SMS verify)
const VELOCITY_THRESHOLD_HIGH = 5;      // > 5 txns/hr from same card → high risk
const VELOCITY_THRESHOLD_MEDIUM = 3;    // > 3 txns/hr → moderate risk

// ── Function: fraud/evaluate ────────────────────────────────────
// This is the main fraud evaluation workflow. It runs every time a
// transaction.authorized event arrives.
//
// The workflow has 5 steps, each memoized by Ironflow. If the process
// crashes mid-evaluation, it resumes from the last completed step —
// it won't re-run signal checks that already succeeded.
//
// recording: true enables the Inspector, which lets you scrub through
// the timeline and see the exact state at each step boundary.

const evaluateFraud = createFunction(
  {
    id: "fraud/evaluate",
    description:
      "Evaluates a transaction for fraud by collecting signals in parallel, " +
      "scoring with a model, and recording the full reasoning chain to an " +
      "entity stream for continuous history.",
    triggers: [{ event: EVENTS.TransactionAuthorized }],
    recording: true,
  },
  async ({ event, step }) => {
    const tx = event.data as TransactionEvent;

    // createClient() connects to the Ironflow server. We use it to
    // interact with KV Store and Entity Streams from within the workflow.
    const client = createClient();

    // ── Step 1: Collect base signals from the transaction ──────
    // Extract the fields we'll need downstream. This step is simple
    // but important: its output is memoized, so on retry we don't
    // re-parse the event.
    const baseSignals = await step.run("collect-signals", async () => {
      return {
        txnId: tx.txnId,
        amount: tx.amount,
        currency: tx.currency,
        merchantMcc: tx.merchantMcc,
        merchantCountry: tx.merchantCountry,
        channel: tx.channel,
        timestamp: new Date().toISOString(),
      };
    });

    // ── Step 2: Run four signal checks in parallel ─────────────
    // step.parallel() runs all four branches simultaneously. Each
    // branch gets its own step client (`s`) for memoization. If one
    // check is slow (e.g. external API), the others don't wait.
    //
    // Each check returns a SignalResult with a riskContribution
    // between 0.0 (no risk) and 0.35 (high risk). These are summed
    // in the scoring step to produce the overall fraud score.
    const [velocity, geo, device, merchantRisk] = await step.parallel(
      "check-signals",
      [
        // ── Velocity: how many transactions on this card recently? ──
        // Uses Ironflow's built-in KV Store as a counter. In production
        // this replaces a Redis cluster — one fewer system to operate.
        async (s) => {
          return await s.run(
            "velocity-check",
            async (): Promise<SignalResult> => {
              const kv = client.kv();
              const bucket = kv.bucket("fraud-velocity");

              // Atomic read-increment via KV store CAS (check-and-set).
              // Uses the revision number to prevent lost updates when
              // two transactions for the same card race concurrently.
              const key = `${tx.cardId}.1h`;
              let count = 0;

              try {
                const entry = await bucket.get(key);
                count =
                  typeof entry.value === "number" ? entry.value : Number(entry.value) || 0;
                // CAS: only succeeds if revision hasn't changed since our read
                await bucket.update(key, count + 1, entry.revision);
              } catch {
                // Key doesn't exist yet — first transaction for this card.
                // create() fails if another writer raced us; the step will
                // retry on the next attempt with the correct revision.
                await bucket.create(key, 1);
              }

              count = count + 1;

              // More transactions in a short window = higher risk
              const riskContribution =
                count > VELOCITY_THRESHOLD_HIGH
                  ? 0.35
                  : count > VELOCITY_THRESHOLD_MEDIUM
                    ? 0.15
                    : 0.0;

              return {
                name: "velocity",
                value: count,
                riskContribution,
              };
            },
          );
        },

        // ── Geo: does the cardholder's location match the transaction? ──
        // Compares three countries: where the card was issued, where the
        // cardholder's IP is, and where the merchant is. A full mismatch
        // (all three differ) is the highest risk signal.
        async (s) => {
          return await s.run(
            "geo-check",
            async (): Promise<SignalResult> => {
              const match = tx.cardCountry === tx.ipCountry;
              const merchantMatch = tx.merchantCountry === tx.cardCountry;

              // Both mismatch = 0.30 (e.g. US card, Nigerian IP, Nigerian merchant)
              // One mismatch = 0.15 (e.g. US card, US IP, Canadian merchant)
              // All match = 0.00 (domestic purchase)
              const riskContribution =
                !match && !merchantMatch
                  ? 0.3
                  : !match || !merchantMatch
                    ? 0.15
                    : 0.0;

              return {
                name: "geo",
                value: match ? "match" : "mismatch",
                riskContribution,
              };
            },
          );
        },

        // ── Device: is this a recognized device fingerprint? ──
        // Unknown devices are riskier. In production, this would
        // query a device intelligence service.
        async (s) => {
          return await s.run(
            "device-check",
            async (): Promise<SignalResult> => {
              return {
                name: "device",
                value: tx.isKnownDevice,
                riskContribution: tx.isKnownDevice ? 0.0 : 0.25,
              };
            },
          );
        },

        // ── Merchant risk: is this a high-risk business category? ──
        // Some MCCs (gambling, telemarketing) carry inherent risk
        // regardless of other signals.
        async (s) => {
          return await s.run(
            "merchant-risk-check",
            async (): Promise<SignalResult> => {
              const highRiskMccs = ["7995", "5967", "5966", "7273"]; // gambling, telemarketing
              const mediumRiskMccs = ["5944", "5815", "5816"];       // jewelry, digital goods

              const isHighRisk = highRiskMccs.includes(tx.merchantMcc);
              const isMediumRisk = mediumRiskMccs.includes(tx.merchantMcc);

              return {
                name: "merchant_risk",
                value: isHighRisk ? "high" : isMediumRisk ? "medium" : "low",
                riskContribution: isHighRisk ? 0.2 : isMediumRisk ? 0.1 : 0.0,
              };
            },
          );
        },
      ],
    );

    const signals = [velocity, geo, device, merchantRisk];

    // ── Step 3: Score the transaction ──────────────────────────
    // Sum the risk contributions from all signals, then write the
    // full evaluation to an entity stream. This is the "continuous
    // history" — every signal, every score, permanently recorded
    // as events on fraud-eval:{txnId}.
    //
    // Entity streams use explicit version tracking for optimistic
    // concurrency. expectedVersion: 0 means "stream must not exist"
    // (first write), then we increment for each subsequent append.
    // This guarantees exactly-once semantics even if a step retries.
    const scoring = await step.run("score", async () => {
      const rawScore = signals.reduce(
        (sum, signal) => sum + signal.riskContribution,
        0,
      );
      const score = Math.min(rawScore, 1.0);

      // Write signals_collected — captures what the model saw
      // expectedVersion: 0 = stream must not exist (first event)
      const signalsCollected = {
        name: STREAM_EVENTS.SignalsCollected,
        data: {
          txnId: tx.txnId,
          cardId: tx.cardId,
          amount: tx.amount,
          signals: signals.map((s) => ({
            name: s.name,
            value: s.value,
            riskContribution: s.riskContribution,
          })),
        },
        entityType: "fraud-evaluation",
      };
      await client.streams.append(`fraud-eval:${tx.txnId}`, signalsCollected, { expectedVersion: 0 });

      // Write model_scored — captures the model's output and thresholds
      // expectedVersion: 1 = stream has exactly 1 event (signals_collected)
      const modelScored = {
        name: STREAM_EVENTS.ModelScored,
        data: {
          txnId: tx.txnId,
          model: MODEL_VERSION,
          score,
          threshold_decline: SCORE_THRESHOLD_DECLINE,
          threshold_challenge: SCORE_THRESHOLD_CHALLENGE,
          signalBreakdown: Object.fromEntries(
            signals.map((s) => [s.name, s.riskContribution]),
          ),
        },
        entityType: "fraud-evaluation",
      };
      await client.streams.append(`fraud-eval:${tx.txnId}`, modelScored, { expectedVersion: 1 });

      return { score, model: MODEL_VERSION };
    });

    // ── Step 4: Make the decision ──────────────────────────────
    // Apply thresholds to the score. The decision and its reasoning
    // are also written to the entity stream — completing the chain:
    // signals_collected → model_scored → decision_made.
    //
    // This chain is what makes continuous history useful: months later,
    // you can open this entity stream and see exactly why a transaction
    // was declined, what the model saw, and what thresholds were active.
    const decision = await step.run("decide", async () => {
      let action: FraudDecision["action"];
      let reason: string;

      if (scoring.score >= SCORE_THRESHOLD_DECLINE) {
        action = "decline";
        reason = `Score ${scoring.score.toFixed(2)} exceeds decline threshold ${SCORE_THRESHOLD_DECLINE}`;
      } else if (scoring.score >= SCORE_THRESHOLD_CHALLENGE) {
        action = "challenge";
        reason = `Score ${scoring.score.toFixed(2)} exceeds challenge threshold ${SCORE_THRESHOLD_CHALLENGE}`;
      } else {
        action = "approve";
        reason = `Score ${scoring.score.toFixed(2)} below all thresholds`;
      }

      const result: FraudDecision = {
        txnId: tx.txnId,
        action,
        score: scoring.score,
        modelVersion: scoring.model,
        signals,
        reason,
      };

      // Write decision_made — the final event in the reasoning chain
      // expectedVersion: 2 = stream has exactly 2 events (signals_collected + model_scored)
      const decisionMade = {
        name: STREAM_EVENTS.DecisionMade,
        data: {
          txnId: tx.txnId,
          action: result.action,
          score: result.score,
          model: result.modelVersion,
          reason: result.reason,
        },
        entityType: "fraud-evaluation",
      };
      await client.streams.append(`fraud-eval:${tx.txnId}`, decisionMade, { expectedVersion: 2 });

      console.log(
        `[fraud/evaluate] ${tx.txnId}: ${action.toUpperCase()} ` +
          `(score=${scoring.score.toFixed(2)}, model=${scoring.model})`,
      );

      return result;
    });

    // ── Step 5: Publish alert if high risk ─────────────────────
    // Declined and challenged transactions publish to the fraud-alerts
    // topic. In production, multiple consumer groups would subscribe:
    // real-time alerting, case management, velocity throttling.
    //
    // step.publish() is durable and memoized — the alert is guaranteed
    // to be published exactly once, even on retry.
    if (decision.action === "decline" || decision.action === "challenge") {
      await step.publish(EVENTS.FraudAlerts, {
        txnId: tx.txnId,
        cardId: tx.cardId,
        action: decision.action,
        score: decision.score,
        reason: decision.reason,
        amount: tx.amount,
        merchantName: tx.merchantName,
        timestamp: new Date().toISOString(),
      });

      console.log(
        `[fraud/evaluate] Alert published to fraud-alerts topic: ${tx.txnId}`,
      );
    }

    return decision;
  },
);

// ── Projection: fraud-decision-stats ────────────────────────────
// A projection is a pure reducer that builds a read model from events.
// This one counts transaction volume. The state is persisted automatically
// and queryable via the API or dashboard.
//
// The real decision data (scores, signals, outcomes) lives in entity
// streams — this projection provides a lightweight aggregate view.

interface DecisionStats {
  total: number;
  approved: number;
  declined: number;
  challenged: number;
  approveRate: number;
  declineRate: number;
  avgScore: number;
  scoreSum: number;
}

const decisionStats = createProjection<DecisionStats>({
  name: "fraud-decision-stats",
  events: [STREAM_EVENTS.DecisionMade],
  initialState: (): DecisionStats => ({
    total: 0,
    approved: 0,
    declined: 0,
    challenged: 0,
    approveRate: 0,
    declineRate: 0,
    avgScore: 0,
    scoreSum: 0,
  }),
  handler: (state: DecisionStats, event: { name: string; data: any }) => {
    const { action, score } = event.data;
    const newTotal = state.total + 1;
    const newScoreSum = state.scoreSum + score;

    const approved = state.approved + (action === "approve" ? 1 : 0);
    const declined = state.declined + (action === "decline" ? 1 : 0);
    const challenged = state.challenged + (action === "challenge" ? 1 : 0);

    return {
      total: newTotal,
      approved,
      declined,
      challenged,
      approveRate: approved / newTotal,
      declineRate: declined / newTotal,
      avgScore: newScoreSum / newTotal,
      scoreSum: newScoreSum,
    };
  },
});

// ── Start the worker ────────────────────────────────────────────
// The worker connects to the Ironflow server in pull mode — it polls
// for events matching its registered functions and runs them locally.
// Functions and projections run together in one process.

const worker = createWorker({
  functions: [evaluateFraud],
  projections: [decisionStats as IronflowProjection],
});

// Ensure the velocity bucket exists before processing any transactions.
// Runs once at startup instead of on every function invocation.
async function ensureBuckets() {
  const client = createClient();
  const kv = client.kv();
  try {
    await kv.createBucket({
      name: "fraud-velocity",
      description: "Transaction velocity counters per card",
    });
  } catch {
    // Bucket already exists — expected on restart
  }
}

ensureBuckets().then(() => worker.start()).then(() => {
  console.log("");
  console.log("  Fraud Detection Pipeline — Running");
  console.log("  ──────────────────────────────────");
  console.log("  Function:    fraud/evaluate");
  console.log("  Projection:  fraud-decision-stats");
  console.log(`  Model:       ${MODEL_VERSION}`);
  console.log("  KV Bucket:   fraud-velocity");
  console.log("  Entity:      fraud-eval:{txnId}");
  console.log("  Topic:       fraud-alerts");
  console.log("");
  console.log("  Waiting for transaction.authorized events...");
  console.log("");
});
