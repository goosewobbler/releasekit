#!/bin/bash
# E2E tests for single package CLI

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/helpers.sh"

trap cleanup_repo EXIT

echo "=== E2E: Single Package Tests ==="

cd "$SCRIPT_DIR"

# Test 1: fix commit → patch bump
echo ""
echo "--- Test: fix commit → patch bump ---"
create_git_repo
create_package_json "test-single-package" "0.1.0"
create_releasekit_config '{"version":{"preset":"conventionalcommits","packages":["./"]}}'
git_commit "chore: initial commit"
git_commit "fix: resolve bug"

output=$(run_cli_json releasekit-version --dry-run --json)
version=$(echo "$output" | jq -r '.updates[0].newVersion' 2>/dev/null || echo "parse_error")
if [[ "$version" == "parse_error" ]]; then
  echo "FAIL: Could not parse JSON output"
  echo "Output: $output"
  exit 1
fi
assert_version "0.1.1" "$version"

# Test 2: feat commit → minor bump
echo ""
echo "--- Test: feat commit → minor bump ---"
create_git_repo
create_package_json "test-single-package" "0.1.0"
create_releasekit_config '{"version":{"preset":"conventionalcommits","packages":["./"]}}'
git_commit "chore: initial commit"
git_commit "feat: add awesome feature"

output=$(run_cli_json releasekit-version --dry-run --json)
version=$(echo "$output" | jq -r '.updates[0].newVersion' 2>/dev/null || echo "parse_error")
if [[ "$version" == "parse_error" ]]; then
  echo "FAIL: Could not parse JSON output"
  echo "Output: $output"
  exit 1
fi
assert_version "0.2.0" "$version"

# Test 3: breaking change → major bump
echo ""
echo "--- Test: breaking change → major bump ---"
create_git_repo
create_package_json "test-single-package" "0.1.0"
create_releasekit_config '{"version":{"preset":"conventionalcommits","packages":["./"]}}'
git_commit "chore: initial commit"
git_commit "feat!: breaking API change"

output=$(run_cli_json releasekit-version --dry-run --json)
version=$(echo "$output" | jq -r '.updates[0].newVersion' 2>/dev/null || echo "parse_error")
if [[ "$version" == "parse_error" ]]; then
  echo "FAIL: Could not parse JSON output"
  echo "Output: $output"
  exit 1
fi
assert_version "1.0.0" "$version"

echo ""
echo "=== All single package tests passed ==="
