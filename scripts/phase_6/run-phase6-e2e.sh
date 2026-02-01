#!/bin/bash
# Run all Phase 6 E2E tests in order.
# Requires .env (or equivalent) with required vars per script; see scripts/phase_6/README.md.
# Exit on first failure.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Running Phase 6 E2E suite..."
echo ""

echo "--- Phase 6 E2E: Conflict resolution ---"
"$SCRIPT_DIR/test-phase6-conflict-resolution.sh"
echo ""

echo "--- Phase 6 E2E: Plans API happy path ---"
"$SCRIPT_DIR/test-phase6-plans-api-happy.sh"
echo ""

echo "--- Phase 6 E2E: Orchestrator cycle ---"
"$SCRIPT_DIR/test-phase6-orchestrator-cycle.sh"
echo ""

echo "Phase 6 E2E suite: all passed."
