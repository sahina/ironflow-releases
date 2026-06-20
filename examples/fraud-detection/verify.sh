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
