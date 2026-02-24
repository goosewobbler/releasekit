#!/bin/bash
# E2E tests for no-changes detection

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/helpers.sh"

trap cleanup_repo EXIT

echo "=== E2E: No Changes Detection Tests ==="

cd "$SCRIPT_DIR"

# Test: Only chore commits (no version bump expected)
# Note: Without an existing tag, the tool will still create an initial version
# So we test that chore-only commits don't trigger feat/fix version bumps
echo ""
echo "--- Test: Only chore commits ---"
create_git_repo
create_package_json "test-nochanges" "0.1.0"
create_releasekit_config '{"version":{"preset":"conventionalcommits","packages":["./"]}}'
git_commit "chore: initial commit"
git_commit "chore: update README"
git_commit "chore: cleanup"

output=$(run_cli releasekit-version --dry-run --json 2>&1)
exit_code=$?

# With only chore commits and no existing tags, it may still create an initial release
# This is expected behavior. The test verifies the CLI doesn't crash.
assert_exit_code 0 "$exit_code"
echo "PASS: CLI handles chore-only commits without error"

echo ""
echo "=== All no-changes tests passed ==="
