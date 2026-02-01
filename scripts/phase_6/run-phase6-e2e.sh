#!/bin/bash
# Run all Phase 6 E2E tests in order.
# Requires .env (or equivalent) with required vars per script; see scripts/phase_6/README.md.
# Exit on first failure.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Running Phase 6 E2E suite..."
echo ""

"$SCRIPT_DIR/test-phase6-conflict-resolution.sh"
echo ""

echo "Phase 6 E2E suite: all passed."
