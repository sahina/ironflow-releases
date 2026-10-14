#!/bin/bash
set -e

PASS=0
FAIL=0

echo ""
echo "=== Fraud Detection Verification ==="
echo ""

# Check function registered
if ironflow function list 2>/dev/null | grep -q "fraud/evaluate"; then
  echo "PASS: Function fraud/evaluate registered"
  PASS=$((PASS + 1))
else
  echo "FAIL: Function fraud/evaluate not registered"
  FAIL=$((FAIL + 1))
fi

# Check completed runs (expect 5 — one declined may fail on insufficient signals)
COMPLETED=$(ironflow run list --function "fraud/evaluate" --status completed 2>/dev/null | grep -c "completed" || true)
if [ "$COMPLETED" -ge 3 ]; then
  echo "PASS: At least 3 completed fraud evaluations (got $COMPLETED)"
  PASS=$((PASS + 1))
else
  echo "FAIL: Expected at least 3 completed evaluations, got $COMPLETED"
  FAIL=$((FAIL + 1))
fi

# Check entity streams exist for transactions
for txn in "fraud-eval:txn_grocery_001" "fraud-eval:txn_electronics_003"; do
  if ironflow stream info "$txn" 2>/dev/null | grep -q "$txn"; then
    echo "PASS: Entity stream $txn exists"
    PASS=$((PASS + 1))
  else
    echo "FAIL: Entity stream $txn not found"
    FAIL=$((FAIL + 1))
  fi
done

# Check the decisions recorded in the reasoning chain match the seeded outcomes
for pair in "txn_grocery_001:approve" "txn_electronics_003:decline" "txn_gambling_004:decline" "txn_coffee_005:challenge"; do
  txn="${pair%%:*}"; action="${pair##*:}"
  if ironflow stream read "fraud-eval:$txn" --json 2>/dev/null | grep -Eq "\"action\": *\"$action\""; then
    echo "PASS: $txn decided $action"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $txn was not decided $action"
    FAIL=$((FAIL + 1))
  fi
done

# Declined and challenged transactions publish to fraud-alerts (3 per seed run)
ALERTS=$(ironflow topic stats fraud-alerts 2>/dev/null | awk '/^Messages:/ {print $2}')
if [ "${ALERTS:-0}" -ge 3 ]; then
  echo "PASS: fraud-alerts topic holds at least 3 alerts (got $ALERTS)"
  PASS=$((PASS + 1))
else
  echo "FAIL: expected at least 3 alerts on fraud-alerts, got ${ALERTS:-0}"
  FAIL=$((FAIL + 1))
fi

# Velocity counter must accumulate. A second transaction on card_alice_1234 (unique txnId,
# so it does not collide with the seeded stream) has to take its KV counter to at least 2.
# Reading the value as a plain number resets it to 1 on every write.
SERVER="${IRONFLOW_SERVER_URL:-http://localhost:9123}"
if ironflow emit transaction.authorized --wait --timeout 30s --data \
  "{\"txnId\":\"txn_verify_$(date +%s)\",\"cardId\":\"card_alice_1234\",\"amount\":10,\"currency\":\"USD\",\"merchantName\":\"Whole Foods Market\",\"merchantMcc\":\"5411\",\"merchantCountry\":\"US\",\"cardCountry\":\"US\",\"ipCountry\":\"US\",\"deviceFingerprint\":\"fp_alice_iphone\",\"isKnownDevice\":true,\"channel\":\"pos\"}" >/dev/null 2>&1; then
  B64=$(curl -fsS "$SERVER/api/v1/kv/buckets/fraud-velocity/keys/card_alice_1234.1h" 2>/dev/null | sed -n 's/.*"value":"\([^"]*\)".*/\1/p')
  COUNT=$(printf '%s' "$B64" | base64 -d 2>/dev/null || true)
  if [ "${COUNT:-0}" -ge 2 ] 2>/dev/null; then
    echo "PASS: velocity counter accumulates for card_alice_1234 (now $COUNT)"
    PASS=$((PASS + 1))
  else
    echo "FAIL: velocity counter for card_alice_1234 is '${COUNT:-missing}', expected >= 2"
    FAIL=$((FAIL + 1))
  fi
else
  echo "FAIL: could not emit and complete the velocity probe transaction"
  FAIL=$((FAIL + 1))
fi

# Check projection registered
if ironflow projection list 2>/dev/null | grep -q "fraud-decision-stats"; then
  echo "PASS: Projection fraud-decision-stats registered"
  PASS=$((PASS + 1))
else
  echo "FAIL: Projection fraud-decision-stats not registered"
  FAIL=$((FAIL + 1))
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && echo "ALL CHECKS PASSED" || echo "SOME CHECKS FAILED"
echo ""
[ "$FAIL" -eq 0 ]
