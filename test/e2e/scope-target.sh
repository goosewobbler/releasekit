#!/bin/bash
# E2E tests for scope-based targeting: wildcard patterns, packageSpecificTags, sync:false

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/helpers.sh"

trap cleanup_repo EXIT

echo "=== E2E: Scope Target Tests ==="

setup_wdio_style_repo() {
  create_git_repo

  mkdir -p packages/{native-utils,native-types,native-spy,electron-service,electron-cdp-bridge,tauri-service}

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

  for pkg in native-utils native-types native-spy; do
    cat > "packages/$pkg/package.json" <<EOF
{
  "name": "@test/$pkg",
  "version": "1.0.0"
}
EOF
  done

  for pkg in electron-service electron-cdp-bridge; do
    cat > "packages/$pkg/package.json" <<EOF
{
  "name": "@test/$pkg",
  "version": "2.0.0"
}
EOF
  done

  cat > packages/tauri-service/package.json <<'EOF'
{
  "name": "@test/tauri-service",
  "version": "3.0.0-next.0"
}
EOF

  cp "$RELEASEKIT_ROOT/fixtures/e2e/wdio-style/releasekit.config.json" .

  git_commit "chore: initial commit"
  # sanitizePackageName strips @ prefix and replaces / with -
  git tag "test-native-utils@v1.0.0"
  git tag "test-native-types@v1.0.0"
  git tag "test-native-spy@v1.0.0"
  git tag "test-electron-service@v2.0.0"
  git tag "test-electron-cdp-bridge@v2.0.0"
  git tag "test-tauri-service@v3.0.0-next.0"
}

# Test 1: --target '@test/native-*' updates only native packages
echo ""
echo "--- Test: wildcard target @test/native-* ---"
setup_wdio_style_repo
# Commits must touch files inside package dirs so git path-filter counts them
echo "fix" > packages/native-utils/fix.txt
echo "fix" > packages/native-types/fix.txt
echo "fix" > packages/native-spy/fix.txt
git_commit "fix: resolve issue in native layer"

set +e
output=$(run_cli_json releasekit release --dry-run --json --target '@test/native-*' --project-dir "$REPO_DIR")
exit_code=$?
set -e

assert_exit_code 0 "$exit_code"
assert_updated "@test/native-utils" "$output"
assert_updated "@test/native-types" "$output"
assert_updated "@test/native-spy" "$output"
assert_not_updated "@test/electron-service" "$output"
assert_not_updated "@test/electron-cdp-bridge" "$output"
assert_not_updated "@test/tauri-service" "$output"

cleanup_repo
REPO_DIR=""

# Test 2: --target '@test/electron-*' updates only electron packages
echo ""
echo "--- Test: wildcard target @test/electron-* ---"
setup_wdio_style_repo
echo "fix" > packages/electron-service/fix.txt
echo "fix" > packages/electron-cdp-bridge/fix.txt
git_commit "fix: resolve electron bridge connection issue"

set +e
output=$(run_cli_json releasekit release --dry-run --json --target '@test/electron-*' --project-dir "$REPO_DIR")
exit_code=$?
set -e

assert_exit_code 0 "$exit_code"
assert_updated "@test/electron-service" "$output"
assert_updated "@test/electron-cdp-bridge" "$output"
assert_not_updated "@test/native-utils" "$output"
assert_not_updated "@test/tauri-service" "$output"

cleanup_repo
REPO_DIR=""

# Test 3: packageSpecificTags produces per-package tag format
echo ""
echo "--- Test: packageSpecificTags generates per-package tags ---"
setup_wdio_style_repo
echo "fix" > packages/native-spy/fix.txt
git_commit "fix: resolve spy reset issue"

set +e
output=$(run_cli_json releasekit release --dry-run --json --target '@test/native-spy' --project-dir "$REPO_DIR")
exit_code=$?
set -e

assert_exit_code 0 "$exit_code"
assert_tag_contains "test-native-spy@v" "$output"
assert_tag_not_contains "test-native-utils@v" "$output"
assert_tag_not_contains "test-electron-service@v" "$output"

version=$(get_updated_version "@test/native-spy" "$output")
assert_version "1.0.1" "$version"

echo ""
echo "=== All scope target tests passed ==="
