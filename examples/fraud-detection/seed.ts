import { createClient } from "@ironflow/node";
import { EVENTS } from "./events";

// ── Sample Transactions ─────────────────────────────────────────
// Five transactions designed to trigger different fraud outcomes.
// Each tells a story that demonstrates continuous history.

const transactions = [
  {
    // Transaction 1: Normal domestic grocery purchase
    // Expected: APPROVE (all signals clean)
    label: "Grocery run at Whole Foods",
    data: {
      txnId: "txn_grocery_001",
      cardId: "card_alice_1234",
      amount: 87.43,
      currency: "USD",
      merchantName: "Whole Foods Market",
      merchantMcc: "5411", // Grocery stores
      merchantCountry: "US",
      cardCountry: "US",
      ipCountry: "US",
      deviceFingerprint: "fp_alice_iphone",
      isKnownDevice: true,
      channel: "pos" as const,
    },
  },
  {
    // Transaction 2: Normal online purchase
    // Expected: APPROVE (known device, countries match)
    label: "Online book purchase",
    data: {
      txnId: "txn_books_002",
      cardId: "card_bob_5678",
      amount: 34.99,
      currency: "USD",
      merchantName: "Barnes & Noble",
      merchantMcc: "5942", // Book stores
      merchantCountry: "US",
      cardCountry: "US",
      ipCountry: "US",
      deviceFingerprint: "fp_bob_laptop",
      isKnownDevice: true,
      channel: "online" as const,
    },
  },
  {
    // Transaction 3: Foreign purchase with geo mismatch + unknown device
    // Expected: DECLINE (geo mismatch + unknown device = high score)
    label: "Suspicious electronics purchase in Lagos",
    data: {
      txnId: "txn_electronics_003",
      cardId: "card_carol_9012",
      amount: 2499.0,
      currency: "USD",
      merchantName: "ElectroMart Lagos",
      merchantMcc: "5732", // Electronics stores
      merchantCountry: "NG",
      cardCountry: "US",
      ipCountry: "NG",
      deviceFingerprint: "fp_unknown_device_x",
      isKnownDevice: false,
      channel: "online" as const,
    },
  },
  {
    // Transaction 4: Gambling site (high-risk MCC) with geo mismatch
    // Expected: DECLINE (high-risk merchant + geo mismatch)
    label: "Online gambling from foreign IP",
    data: {
      txnId: "txn_gambling_004",
      cardId: "card_dave_3456",
      amount: 500.0,
      currency: "USD",
      merchantName: "LuckyStar Casino",
      merchantMcc: "7995", // Gambling
      merchantCountry: "CW",
      cardCountry: "US",
      ipCountry: "CW",
      deviceFingerprint: "fp_dave_tablet",
      isKnownDevice: true,
      channel: "online" as const,
    },
  },
  {
    // Transaction 5: Moderate risk — known device, small geo mismatch
    // Expected: CHALLENGE (merchant country differs but IP matches card)
    label: "Cross-border coffee shop — traveling in Canada",
    data: {
      txnId: "txn_coffee_005",
      cardId: "card_eve_7890",
      amount: 6.5,
      currency: "CAD",
      merchantName: "Tim Hortons",
      merchantMcc: "5812", // Restaurants
      merchantCountry: "CA",
      cardCountry: "US",
      ipCountry: "US",
      deviceFingerprint: "fp_eve_phone",
      isKnownDevice: true,
      channel: "contactless" as const,
    },
  },
];

// ── Emit Transactions ───────────────────────────────────────────

async function seed() {
  const client = createClient();

  console.log("");
  console.log("  Seeding 5 transactions...");
  console.log("  ─────────────────────────");
  console.log("");

  for (const tx of transactions) {
    await client.emit(EVENTS.TransactionAuthorized, tx.data);
    console.log(`  Sent: ${tx.label}`);
    console.log(`        ${tx.data.txnId} — $${tx.data.amount} at ${tx.data.merchantName}`);
    console.log("");

    // Small delay so events process in order
    await new Promise((r) => setTimeout(r, 1500));
  }

  console.log("  ─────────────────────────");
  console.log("  All 5 transactions emitted.");
  console.log("");
  console.log("  Next steps:");
  console.log("  1. Open the dashboard at http://localhost:9123");
  console.log("  2. Go to Runs — see all 5 fraud evaluations");
  console.log("  3. Click a run — see every step with inputs and outputs");
  console.log("  4. Click Inspector on a declined run — scrub the timeline");
  console.log("  5. Go to Streams — open fraud-eval:txn_electronics_003");
  console.log("     See the full reasoning chain: signals → score → decision");
  console.log("");
}

seed().catch(console.error);
