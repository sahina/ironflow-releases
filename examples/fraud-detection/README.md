# Fraud Detection Pipeline

A real-time fraud evaluation system that demonstrates **Continuous History** —
Ironflow's approach to capturing every state change automatically so you can
inspect, replay, and audit everything that happened.

```text
  transaction        ┌────────────────────────────────┐
  authorized         │      fraud/evaluate            │
  ─────────────────► │                                │
                     │  1. Collect base signals       │
                     │  2. Parallel signal checks:    │
                     │     ├─ velocity  (KV Store)    │
                     │     ├─ geo       (country)     │
                     │     ├─ device    (fingerprint) │
                     │     └─ merchant  (MCC code)    │
                     │  3. Score with fraud model     │
                     │  4. Decide: approve / decline  │
                     │  5. Publish alert if risky     │
                     └──────────┬─────────────────────┘
                                │
              ┌─────────────────┼─────────────────────┐
              ▼                 ▼                     ▼
     fraud-eval:{txnId}   fraud-alerts       fraud-decision-stats
     (entity stream)      (pub/sub topic)    (projection)
     Full reasoning       Real-time alerts   Live metrics
     chain captured       for downstream     by model version
```

---

## What You'll Learn

This example teaches four concepts through a working system you can run locally.

### 1. Total Recall

Every fraud evaluation is recorded as a series of events in an **entity stream**:
`signals_collected` → `model_scored` → `decision_made`. Not just the verdict —
the entire reasoning chain. You never configure logging or tracing. Every state
change is captured automatically because the system is built on event sourcing.

```text
  Entity Stream: fraud-eval:txn_electronics_003

  ┌─────────────────────────────────────────────────────────┐
  │ Event 1: signals_collected                              │
  │   velocity: 1, geo: "mismatch", device: unknown,        │
  │   merchant_risk: "low"                                  │
  ├─────────────────────────────────────────────────────────┤
  │ Event 2: model_scored                                   │
  │   model: "fraud_v4.2", score: 0.55,                     │
  │   breakdown: { geo: 0.30, device: 0.25,                 │
  │                velocity: 0.00, merchant: 0.00 }         │
  ├─────────────────────────────────────────────────────────┤
  │ Event 3: decision_made                                  │
  │   action: "decline", reason: "score 0.55 exceeds        │
  │   decline threshold 0.50"                               │
  └─────────────────────────────────────────────────────────┘
```

### 2. Time Travel

Open any fraud evaluation in the **Inspector** (the time-travel debugger). Scrub
the timeline backward and forward to see the exact state at any moment: which
signals were active, what the model saw, what score it produced. This is how you
investigate false positives — not by querying 4 different logs, but by replaying
history.

```text
  Inspector Timeline

  ──●────────●────────────●──────────●──────────●──►
    │        │            │          │          │
    collect  velocity     geo        score      decide
    signals  check        check      0.55       DECLINE
             count=1      mismatch

  Scrub to any point ◄──────────────────────────────►
  See exact state at that moment
```

### 3. Attribution

Every event records **who** made the decision. The `model_scored` event captures
which model version (`fraud_v4.2`), which thresholds were active, and what signal
breakdown produced the score. When the model is updated to v4.3 next quarter, you
can trace exactly which decisions v4.2 made and compare.

### 4. Replayability

The fraud evaluation is a **durable workflow**. Each step is memoized — if the
process crashes after scoring but before deciding, it resumes from the score
step without re-running the signal checks. And because the full reasoning chain
lives in entity streams, you can replay old transactions through a new model to
compare decisions before deploying.

---

## How It Works

### The Workflow

When a `transaction.authorized` event arrives, the `fraud/evaluate` function
runs five steps:

| Step                | What it does                                                               | Ironflow feature                         |
| ------------------- | -------------------------------------------------------------------------- | ---------------------------------------- |
| **collect-signals** | Extracts base transaction data from the event                              | `step.run()` — memoized, durable         |
| **check-signals**   | Runs 4 checks simultaneously: velocity, geo, device, merchant risk         | `step.parallel()` — concurrent branches  |
| **score**           | Combines all signals into a fraud score, writes to entity stream           | `step.run()` + `client.streams.append()` |
| **decide**          | Applies thresholds: approve / challenge / decline, writes to entity stream | `step.run()` + `client.streams.append()` |
| **publish alert**   | If risky, publishes to `fraud-alerts` topic for downstream systems         | `step.publish()` — durable pub/sub       |

### Parallel Signal Checks

The four signal checks run **simultaneously**, not sequentially. Each is
independent — if one is slow, the others don't wait. Each returns a risk
contribution score (0.0 to 0.35):

```text
  step.parallel("check-signals")
  ┌──────────────────────┬──────────────────────────────────────────┐
  │ Signal               │ How it works                             │
  ├──────────────────────┼──────────────────────────────────────────┤
  │ velocity-check       │ Reads/increments counter in KV Store.    │
  │                      │ > 5 txns/hr = 0.35 risk.                 │
  │                      │ No Redis needed — built-in KV.           │
  ├──────────────────────┼──────────────────────────────────────────┤
  │ geo-check            │ Compares card country vs IP country vs   │
  │                      │ merchant country. Mismatch = 0.30 risk.  │
  ├──────────────────────┼──────────────────────────────────────────┤
  │ device-check         │ Is this a known device fingerprint?      │
  │                      │ Unknown device = 0.25 risk.              │
  ├──────────────────────┼──────────────────────────────────────────┤
  │ merchant-risk-check  │ Checks merchant category code (MCC).     │
  │                      │ Gambling, telemarketing = 0.20 risk.     │
  └──────────────────────┴──────────────────────────────────────────┘
```

### Entity Streams

Each transaction gets its own entity stream (`fraud-eval:{txnId}`) with three
events capturing the full reasoning chain. This is **continuous history** — you
don't configure what to log. Every state change is an event, and every event is
permanent and queryable.

### Projections

The `fraud-decision-stats` projection maintains running statistics across all
evaluations. It updates in real time as transactions flow through — no batch
job, no nightly ETL.

---

## Run the Demo

### Prerequisites

- Ironflow binary built (`make build` from the repo root)
- Node.js 22+ and pnpm

### Step 1: Build and Start Ironflow

From the repository root:

```bash
make all                       # Build binary and dashboard
./build/ironflow serve --dev   # Start server at localhost:9123
```

Server starts at `http://localhost:9123`. The `--dev` flag disables auth for
local development.

### Step 2: Install and Start the Worker

In another terminal:

```bash
cd examples/fraud-detection
pnpm -C ../../sdk/js build     # Build the JS SDK (examples link to local packages)
pnpm install
pnpm start
```

You should see:

```text
  Fraud Detection Pipeline — Running
  ──────────────────────────────────
  Function:    fraud/evaluate
  Projection:  fraud-decision-stats
  Model:       fraud_v4.2
  KV Bucket:   fraud-velocity
  Entity:      fraud-eval:{txnId}
  Topic:       fraud-alerts

  Waiting for transaction.authorized events...
```

### Step 3: Seed Sample Transactions

In a new terminal:

```bash
pnpm seed
```

This emits 5 transactions designed to trigger different outcomes:

| #   | Transaction               | Amount | Expected outcome | Why                                        |
| --- | ------------------------- | ------ | ---------------- | ------------------------------------------ |
| 1   | Grocery at Whole Foods    | $87.43 | **Approve**      | Domestic, known device, low-risk merchant  |
| 2   | Online book purchase      | $34.99 | **Approve**      | Known device, countries match              |
| 3   | Electronics in Lagos      | $2,499 | **Decline**      | Geo mismatch + unknown device              |
| 4   | Online gambling (Curacao) | $500   | **Decline**      | High-risk MCC + geo mismatch               |
| 5   | Coffee in Canada          | $6.50  | **Challenge**    | Partial geo mismatch (merchant country)    |

Watch the worker terminal — you'll see each evaluation logged with its score and
decision.

### Step 4: Explore in the Dashboard

Open `http://localhost:9123` in your browser.

**Runs page** — See all 5 fraud evaluations. Each shows the function, status,
and timing. Click any run to see every step with its inputs and outputs.

**Streams page** — Open `fraud-eval:txn_electronics_003` (the declined
transaction). You'll see three events: `signals_collected`, `model_scored`,
`decision_made`. This is the complete reasoning chain — why it was declined,
what the model saw, what score it produced.

**Inspector** — On any completed run, click Inspector. Scrub the timeline to
see the exact state at each step boundary. Compare the approved grocery
transaction with the declined electronics transaction side by side.

### Step 5: Verify

```bash
chmod +x verify.sh
./verify.sh
```

---

## The Five Transactions, Explained

### Transaction 1: Whole Foods ($87.43) — Approve

```text
  Signals: velocity=1 (0.00), geo=match (0.00),
           device=known (0.00), merchant=low (0.00)
  Score:   0.00
  Action:  APPROVE — all signals clean
```

This is the baseline. Everything is normal: domestic purchase, known device,
low-risk grocery merchant. Score is 0.00 because no signals contribute risk.

### Transaction 2: Barnes & Noble ($34.99) — Approve

```text
  Signals: velocity=1 (0.00), geo=match (0.00),
           device=known (0.00), merchant=low (0.00)
  Score:   0.00
  Action:  APPROVE — clean online purchase
```

Different card, different merchant, same outcome. Online channel doesn't add
risk when everything else checks out.

### Transaction 3: ElectroMart Lagos ($2,499) — Decline

```text
  Signals: velocity=1 (0.00), geo=mismatch (0.30),
           device=unknown (0.25), merchant=low (0.00)
  Score:   0.55
  Action:  DECLINE — geo mismatch + unknown device

  Entity stream: fraud-eval:txn_electronics_003
  Three events capture the full reasoning chain.
  Open in Inspector to scrub the timeline.
```

This is the interesting one. The card is issued in the US but the purchase is
in Nigeria from an unknown device. Two signals fire: geo (0.30) and device
(0.25). Combined score 0.55 exceeds the decline threshold (0.50).

In the entity stream, you can see exactly what the model saw at decision time —
not a summary, not a log line, but the actual signal values and their
contributions.

### Transaction 4: LuckyStar Casino ($500) — Decline

```text
  Signals: velocity=1 (0.00), geo=mismatch (0.30),
           device=known (0.00), merchant=high (0.20)
  Score:   0.50
  Action:  DECLINE — gambling site + foreign IP
```

Known device, but the merchant is in Curacao (gambling jurisdiction) and the MCC
is 7995 (gambling). Geo mismatch (0.30) plus high-risk merchant (0.20) pushes
the score to exactly the decline threshold (0.50).

### Transaction 5: Tim Hortons ($6.50) — Challenge

```text
  Signals: velocity=1 (0.00), geo=partial (0.15),
           device=known (0.00), merchant=low (0.00)
  Score:   0.15
  Action:  CHALLENGE — cross-border merchant
```

Eve is traveling in Canada. Her IP is still US (phone on US cellular), but the
merchant is Canadian. This partial geo mismatch adds moderate risk (0.15),
which hits the challenge threshold but not the decline threshold. The system
challenges — perhaps a push notification to confirm.

---

## What to Try Next

**Inspect the entity stream** — Go to Streams in the dashboard. Open
`fraud-eval:txn_electronics_003`. Read the three events in order. This is
continuous history: the complete reasoning chain for why this transaction was
declined, captured automatically.

**Use the Inspector** — Open a declined run and scrub the timeline. See the
exact signals at the moment of scoring. Compare with an approved transaction.
This is time travel.

**Emit more transactions** — Run `pnpm seed` again. Watch the velocity counters
increment in the KV store. Transactions from the same card will score higher
as velocity increases.

**Check the topic** — Look at the `fraud-alerts` pub/sub topic in the
dashboard. Declined and challenged transactions publish alerts here. In a
production system, multiple consumer groups would subscribe: alerting, case
management, velocity throttling.

---

## Ironflow Features Used

| Feature                                      | What it does in this demo                                    |
| -------------------------------------------- | ------------------------------------------------------------ |
| **Functions** (`createFunction`)             | Orchestrates the evaluation workflow with durable steps      |
| **step.parallel()**                          | Runs 4 signal checks simultaneously                          |
| **step.run()**                               | Each step is memoized — survives crashes, never re-executes  |
| **Entity Streams** (`client.streams.append`) | Records the full reasoning chain per transaction             |
| **KV Store** (`client.kv()`)                 | Velocity counters per card (replaces Redis)                  |
| **Pub/Sub** (`step.publish()`)               | Publishes fraud alerts to downstream consumers               |
| **Projections** (`createProjection`)         | Real-time decision statistics                                |
| **Inspector**                                | Time-travel debugging — scrub to any point in the evaluation |
| **Recording** (`recording: true`)            | Enables the Inspector for this function                      |
