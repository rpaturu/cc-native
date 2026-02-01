#!/bin/bash
# Run all Phase 7 E2E tests in order.
# Requires .env (or equivalent) with required vars per script; see scripts/phase_7/README.md.
# Exit on first failure.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Running Phase 7 E2E suite..."
echo ""

echo "--- Phase 7 E2E: Plan Ledger (resume → ledger entries) ---"
"$SCRIPT_DIR/test-phase7-plan-ledger.sh"
echo ""

echo "--- Phase 7 E2E: Validator run (resume → VALIDATOR_RUN in ledger) ---"
"$SCRIPT_DIR/test-phase7-validator-run.sh"
echo ""

echo "--- Phase 7 E2E: Budget reserve (governance Lambda → BUDGET_RESERVE in ledger) ---"
"$SCRIPT_DIR/test-phase7-budget-reserve.sh"
echo ""

echo "--- Phase 7 E2E: Outcomes capture (requires OUTCOMES_TABLE_NAME from .env) ---"
"$SCRIPT_DIR/test-phase7-outcomes-capture.sh"
echo ""

echo "Phase 7 E2E suite: all passed."
