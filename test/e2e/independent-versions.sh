#!/bin/bash
# E2E tests for independent versioning (sync:false) with packages at different baselines
# Mirrors the wdio-desktop-mobile pattern: electron at 2.x, tauri at 3.x prerelease

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/helpers.sh"

trap cleanup_repo EXIT

echo "=== E2E: Independent Versions Tests ==="

setup_mixed_versions_repo() {
  create_git_repo

  mkdir -p packages/{electron-service,electron-cdp-bridge,tauri-service}

  cat > package.json <<'EOF'
{
  "name": "wdio-style-fixture",
  "version": "0.0.0",
  "private": true
}
EOF

  cat > pnpm-workspace.yaml <<'EOF'
packages:
  - 'packages/*'
EOF

  cat > packages/electron-service/package.json <<'EOF'
{
  "name": "@test/electron-service",
  "version": "2.0.0"
}
EOF

  cat > packages/electron-cdp-bridge/package.json <<'EOF'
{
  "name": "@test/electron-cdp-bridge",
  "version": "2.0.0"
}
EOF

  cat > packages/tauri-service/package.json <<'EOF'
{
  "name": "@test/tauri-service",
  "version": "3.0.0-next.0"
}
EOF

  cat > releasekit.config.json <<'EOF'
{
  "version": {
    "preset": "angular",
    "sync": false,
    "packageSpecificTags": true,
    "tagTemplate": "${packageName}@v${version}",
    "prereleaseIdentifier": "next",
    "mismatchStrategy": "prefer-package",
    "packages": ["packages/*"]
  }
}
EOF

  git_commit "chore: initial commit"
  # sanitizePackageName strips @ prefix and replaces / with -
  git tag "test-electron-service@v2.0.0"
  git tag "test-electron-cdp-bridge@v2.0.0"
  git tag "test-tauri-service@v3.0.0-next.0"
}

# Test 1: Targeting electron-service bumps from 2.0.0, not affecting tauri at 3.x
echo ""
echo "--- Test: electron-service bumps independently from 2.0.0 ---"
setup_mixed_versions_repo
echo "fix" > packages/electron-service/fix.txt
git_commit "fix: fix electron service startup"

set +e
output=$(run_cli_json releasekit release --dry-run --json --target '@test/electron-service' --project-dir "$REPO_DIR")
exit_code=$?
set -e

assert_exit_code 0 "$exit_code"
assert_updated "@test/electron-service" "$output"
assert_not_updated "@test/electron-cdp-bridge" "$output"
assert_not_updated "@test/tauri-service" "$output"

version=$(get_updated_version "@test/electron-service" "$output")
assert_version "2.0.1" "$version"

cleanup_repo
REPO_DIR=""

# Test 2: Targeting both electron packages bumps them from their shared 2.x baseline
echo ""
echo "--- Test: electron-* bumps independently from tauri 3.x ---"
setup_mixed_versions_repo
echo "feat" > packages/electron-service/feat.txt
echo "feat" > packages/electron-cdp-bridge/feat.txt
git_commit "feat: add electron bridge method"

set +e
output=$(run_cli_json releasekit release --dry-run --json --target '@test/electron-*' --project-dir "$REPO_DIR")
exit_code=$?
set -e

assert_exit_code 0 "$exit_code"
assert_updated "@test/electron-service" "$output"
assert_updated "@test/electron-cdp-bridge" "$output"
assert_not_updated "@test/tauri-service" "$output"

service_version=$(get_updated_version "@test/electron-service" "$output")
bridge_version=$(get_updated_version "@test/electron-cdp-bridge" "$output")
assert_version "2.1.0" "$service_version"
assert_version "2.1.0" "$bridge_version"

echo "PASS: Both electron packages bump from 2.x baseline, tauri-service is unaffected"

echo ""
echo "=== All independent versions tests passed ==="
