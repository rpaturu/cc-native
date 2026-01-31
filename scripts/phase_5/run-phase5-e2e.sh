#!/bin/bash
# Run all Phase 5 E2E tests in order.
# Requires .env (or equivalent) with required vars per script; see scripts/phase_5/README.md.
# Exit on first failure.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Running Phase 5 E2E suite..."
echo ""

"$SCRIPT_DIR/test-phase5-autoexec.sh"
echo ""

"$SCRIPT_DIR/test-phase5-fallback.sh"
echo ""

"$SCRIPT_DIR/test-phase5-decision-scheduler.sh"
echo ""

"$SCRIPT_DIR/test-phase5-audit-export.sh"
echo ""

echo "Phase 5 E2E suite: all passed."
