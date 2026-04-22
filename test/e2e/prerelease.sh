#!/bin/bash
# E2E tests for prerelease versioning

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/helpers.sh"

trap cleanup_repo EXIT

echo "=== E2E: Prerelease Tests ==="

cd "$SCRIPT_DIR"

# Test 1: Prerelease with default identifier (next)
echo ""
echo "--- Test: Prerelease with default identifier (next) ---"
create_git_repo
create_package_json "test-prerelease" "0.1.0"
create_releasekit_config '{"version":{"preset":"conventionalcommits","packages":["./"]}}'
git_commit "chore: initial commit"
git_commit "feat: add feature"

set +e
output=$(run_cli_json releasekit release --dry-run --json --prerelease --project-dir "$REPO_DIR")
exit_code=$?
set -e

assert_exit_code 0 "$exit_code"
version=$(get_version_from_json "$output")

if [[ "$version" != *"next"* ]]; then
  echo "FAIL: Expected prerelease version with 'next' identifier, got $version"
  exit 1
fi
echo "PASS: Prerelease version contains 'next' identifier: $version"

cleanup_repo
REPO_DIR=""

# Test 2: Prerelease with custom identifier (beta)
echo ""
echo "--- Test: Prerelease with custom identifier (beta) ---"
create_git_repo
create_package_json "test-prerelease" "0.1.0"
create_releasekit_config '{"version":{"preset":"conventionalcommits","packages":["./"]}}'
git_commit "chore: initial commit"
git_commit "feat: add feature"

set +e
output=$(run_cli_json releasekit release --dry-run --json --prerelease=beta --project-dir "$REPO_DIR")
exit_code=$?
set -e

assert_exit_code 0 "$exit_code"
version=$(get_version_from_json "$output")

if [[ "$version" != *"beta"* ]]; then
  echo "FAIL: Expected prerelease version with 'beta' identifier, got $version"
  exit 1
fi
echo "PASS: Prerelease version contains 'beta' identifier: $version"

echo ""
echo "=== All prerelease tests passed ==="
