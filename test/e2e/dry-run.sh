#!/bin/bash
# E2E tests for --dry-run: verify no files are modified

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/helpers.sh"

trap cleanup_repo EXIT

echo "=== E2E: Dry Run File Preservation Tests ==="

cd "$SCRIPT_DIR"

# Test 1: dry-run should not modify package.json
echo ""
echo "--- Test: dry-run preserves package.json version ---"
create_git_repo
create_package_json "test-dry-run" "0.1.0"
create_releasekit_config '{"version":{"preset":"conventionalcommits","packages":["./"]}}'
git_commit "chore: initial commit"
git_commit "feat: new feature"

# Capture version before
version_before=$(jq -r '.version' package.json)

# Run with dry-run
run_cli_json releasekit-version --dry-run --json > /dev/null 2>&1

# Check version after
version_after=$(jq -r '.version' package.json)

if [[ "$version_before" != "$version_after" ]]; then
  echo "FAIL: package.json was modified during dry-run (before=$version_before, after=$version_after)"
  exit 1
fi
echo "PASS: package.json version unchanged ($version_before → $version_after)"

# Test 2: non-dry-run should modify package.json
echo ""
echo "--- Test: non-dry-run does modify package.json ---"
create_git_repo
create_package_json "test-no-dry-run" "0.1.0"
create_releasekit_config '{"version":{"preset":"conventionalcommits","packages":["./"]}}'
git_commit "chore: initial commit"
git_commit "feat: new feature"

version_before=$(jq -r '.version' package.json)

# Run without dry-run (this will also try to git commit/tag, which is fine)
run_cli releasekit-version --json > /dev/null 2>&1 || true

version_after=$(jq -r '.version' package.json)

if [[ "$version_before" == "$version_after" ]]; then
  echo "FAIL: package.json was NOT modified without dry-run (still $version_before)"
  exit 1
fi
echo "PASS: package.json version changed ($version_before → $version_after)"

echo ""
echo "=== All dry-run tests passed ==="
