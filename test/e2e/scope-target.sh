#!/bin/bash
# E2E tests for scope-based targeting: wildcard patterns, packageSpecificTags, sync:false

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/helpers.sh"

trap cleanup_repo EXIT

echo "=== E2E: Scope Target Tests ==="

setup_scoped_repo() {
  create_git_repo

  mkdir -p packages/{core-utils,core-types,core-spy,platform-service,platform-bridge,runtime-service}

  cat > package.json <<'EOF'
{
  "name": "scoped-monorepo-fixture",
  "version": "0.0.0",
  "private": true
}
EOF

  cat > pnpm-workspace.yaml <<'EOF'
packages:
  - 'packages/*'
EOF

  for pkg in core-utils core-types core-spy; do
    cat > "packages/$pkg/package.json" <<EOF
{
  "name": "@test/$pkg",
  "version": "1.0.0"
}
EOF
  done

  for pkg in platform-service platform-bridge; do
    cat > "packages/$pkg/package.json" <<EOF
{
  "name": "@test/$pkg",
  "version": "2.0.0"
}
EOF
  done

  cat > packages/runtime-service/package.json <<'EOF'
{
  "name": "@test/runtime-service",
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
  },
  "ci": {
    "releaseTrigger": "label",
    "scopeLabels": {
      "scope:shared": "@test/core-*",
      "scope:utils": "@test/core-utils",
      "scope:types": "@test/core-types",
      "scope:spy": "@test/core-spy",
      "scope:platform": "@test/platform-*",
      "scope:runtime": "@test/runtime-*"
    }
  }
}
EOF

  git_commit "chore: initial commit"
  # sanitizePackageName strips @ prefix and replaces / with -
  git tag "test-core-utils@v1.0.0"
  git tag "test-core-types@v1.0.0"
  git tag "test-core-spy@v1.0.0"
  git tag "test-platform-service@v2.0.0"
  git tag "test-platform-bridge@v2.0.0"
  git tag "test-runtime-service@v3.0.0-next.0"
}

# Test 1: --target '@test/core-*' updates only core packages
echo ""
echo "--- Test: wildcard target @test/core-* ---"
setup_scoped_repo
# Commits must touch files inside package dirs so git path-filter counts them
echo "fix" > packages/core-utils/fix.txt
echo "fix" > packages/core-types/fix.txt
echo "fix" > packages/core-spy/fix.txt
git_commit "fix: resolve issue in core layer"

set +e
output=$(run_cli_json releasekit release --dry-run --json --target '@test/core-*' --project-dir "$REPO_DIR")
exit_code=$?
set -e

assert_exit_code 0 "$exit_code"
assert_updated "@test/core-utils" "$output"
assert_updated "@test/core-types" "$output"
assert_updated "@test/core-spy" "$output"
assert_not_updated "@test/platform-service" "$output"
assert_not_updated "@test/platform-bridge" "$output"
assert_not_updated "@test/runtime-service" "$output"

cleanup_repo
REPO_DIR=""

# Test 2: --target '@test/platform-*' updates only platform packages
echo ""
echo "--- Test: wildcard target @test/platform-* ---"
setup_scoped_repo
echo "fix" > packages/platform-service/fix.txt
echo "fix" > packages/platform-bridge/fix.txt
git_commit "fix: resolve platform bridge connection issue"

set +e
output=$(run_cli_json releasekit release --dry-run --json --target '@test/platform-*' --project-dir "$REPO_DIR")
exit_code=$?
set -e

assert_exit_code 0 "$exit_code"
assert_updated "@test/platform-service" "$output"
assert_updated "@test/platform-bridge" "$output"
assert_not_updated "@test/core-utils" "$output"
assert_not_updated "@test/runtime-service" "$output"

cleanup_repo
REPO_DIR=""

# Test 3: packageSpecificTags produces per-package tag format
echo ""
echo "--- Test: packageSpecificTags generates per-package tags ---"
setup_scoped_repo
echo "fix" > packages/core-spy/fix.txt
git_commit "fix: resolve spy reset issue"

set +e
output=$(run_cli_json releasekit release --dry-run --json --target '@test/core-spy' --project-dir "$REPO_DIR")
exit_code=$?
set -e

assert_exit_code 0 "$exit_code"
assert_tag_contains "test-core-spy@v" "$output"
assert_tag_not_contains "test-core-utils@v" "$output"
assert_tag_not_contains "test-platform-service@v" "$output"

version=$(get_updated_version "@test/core-spy" "$output")
assert_version "1.0.1" "$version"

# The update record must carry its tag so the publish pipeline knows to push per-package
tag=$(get_update_tag "@test/core-spy" "$output")
assert_update_has_tag "@test/core-spy" "$tag" "$output"
if [[ "$tag" != *"test-core-spy@v"* ]]; then
  echo "FAIL: Expected update tag to match 'test-core-spy@v*', got '$tag'"
  exit 1
fi
echo "PASS: update.tag '$tag' matches packageSpecificTags format"

echo ""
echo "=== All scope target tests passed ==="
