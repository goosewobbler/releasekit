#!/bin/bash
# E2E tests for prereleaseIdentifier configured in releasekit.config.json
# Verifies that the config's prereleaseIdentifier is used without explicit CLI flag

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/helpers.sh"

trap cleanup_repo EXIT

echo "=== E2E: Config-Driven Prerelease Identifier Tests ==="

setup_configured_prerelease_repo() {
  local identifier="${1:-next}"
  create_git_repo
  create_package_json "test-config-prerelease" "1.0.0"
  cat > releasekit.config.json <<EOF
{
  "version": {
    "preset": "angular",
    "prereleaseIdentifier": "$identifier",
    "packages": ["./"]
  }
}
EOF
  git_commit "chore: initial commit"
  git tag "v1.0.0"
}

# Test 1: --prerelease (no identifier) uses prereleaseIdentifier from config
echo ""
echo "--- Test: --prerelease uses config prereleaseIdentifier 'next' ---"
setup_configured_prerelease_repo "next"
git_commit "feat: add new capability"

set +e
output=$(run_cli_json releasekit release --dry-run --json --prerelease --project-dir "$REPO_DIR")
exit_code=$?
set -e

assert_exit_code 0 "$exit_code"
version=$(get_version_from_json "$output")
if [[ "$version" != *"next"* ]]; then
  echo "FAIL: Expected version with 'next' identifier from config, got $version"
  exit 1
fi
echo "PASS: --prerelease uses config identifier 'next': $version"

cleanup_repo
REPO_DIR=""

# Test 2: Explicit --prerelease=beta overrides config's 'next' identifier
echo ""
echo "--- Test: --prerelease=beta overrides config identifier ---"
setup_configured_prerelease_repo "next"
git_commit "feat: add another capability"

set +e
output=$(run_cli_json releasekit release --dry-run --json --prerelease=beta --project-dir "$REPO_DIR")
exit_code=$?
set -e

assert_exit_code 0 "$exit_code"
version=$(get_version_from_json "$output")
if [[ "$version" != *"beta"* ]]; then
  echo "FAIL: Expected version with 'beta' identifier override, got $version"
  exit 1
fi
echo "PASS: --prerelease=beta overrides config identifier: $version"

cleanup_repo
REPO_DIR=""

# Test 3: Custom identifier in config is respected
echo ""
echo "--- Test: custom prereleaseIdentifier 'rc' in config is respected ---"
setup_configured_prerelease_repo "rc"
git_commit "fix: stabilize release candidate"

set +e
output=$(run_cli_json releasekit release --dry-run --json --prerelease --project-dir "$REPO_DIR")
exit_code=$?
set -e

assert_exit_code 0 "$exit_code"
version=$(get_version_from_json "$output")
if [[ "$version" != *"rc"* ]]; then
  echo "FAIL: Expected version with 'rc' identifier from config, got $version"
  exit 1
fi
echo "PASS: Custom config identifier 'rc' is respected: $version"

echo ""
echo "=== All config-driven prerelease tests passed ==="
