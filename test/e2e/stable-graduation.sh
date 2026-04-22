#!/bin/bash
# E2E tests for prerelease → stable graduation lifecycle

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/helpers.sh"

trap cleanup_repo EXIT

echo "=== E2E: Stable Graduation Tests ==="

setup_prerelease_repo() {
  create_git_repo

  mkdir -p packages/{native-spy,electron-service,tauri-service}

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

  cat > packages/native-spy/package.json <<'EOF'
{
  "name": "@test/native-spy",
  "version": "1.0.0"
}
EOF

  cat > packages/electron-service/package.json <<'EOF'
{
  "name": "@test/electron-service",
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
  git tag "test-native-spy@v1.0.0"
  git tag "test-electron-service@v2.0.0"
  git tag "test-tauri-service@v3.0.0-next.0"
}

# Test 1: --stable graduates prerelease package to stable
echo ""
echo "--- Test: --stable graduates 3.0.0-next.0 to 3.0.0 ---"
setup_prerelease_repo
echo "feat" > packages/tauri-service/feat.txt
git_commit "feat: add tauri capability"

set +e
output=$(run_cli_json releasekit release --dry-run --json --stable --target '@test/tauri-service' --project-dir "$REPO_DIR")
exit_code=$?
set -e

assert_exit_code 0 "$exit_code"
assert_updated "@test/tauri-service" "$output"
assert_not_updated "@test/native-spy" "$output"
assert_not_updated "@test/electron-service" "$output"

version=$(get_updated_version "@test/tauri-service" "$output")
assert_version "3.0.0" "$version"

cleanup_repo
REPO_DIR=""

# Test 2: Prerelease then graduation (full lifecycle in dry-run)
echo ""
echo "--- Test: prepatch creates prerelease, --stable graduates it ---"
setup_prerelease_repo

# Simulate a package going from stable to prerelease
echo "fix" > packages/native-spy/fix.txt
git_commit "fix: fix spy mock reset"

set +e
pre_output=$(run_cli_json releasekit release --dry-run --json --bump prepatch --target '@test/native-spy' --project-dir "$REPO_DIR")
pre_exit=$?
set -e

assert_exit_code 0 "$pre_exit"
pre_version=$(get_updated_version "@test/native-spy" "$pre_output")
if [[ "$pre_version" != *"next"* ]]; then
  echo "FAIL: Expected prerelease version with 'next', got $pre_version"
  exit 1
fi
echo "PASS: Prepatch produced prerelease version: $pre_version"

echo "feat" > packages/tauri-service/feat.txt
git_commit "feat: add tauri capability"

# Now verify that a package already at prerelease can be graduated
# tauri-service is at 3.0.0-next.0, --stable should produce 3.0.0
set +e
stable_output=$(run_cli_json releasekit release --dry-run --json --stable --target '@test/tauri-service' --project-dir "$REPO_DIR")
stable_exit=$?
set -e

assert_exit_code 0 "$stable_exit"
stable_version=$(get_updated_version "@test/tauri-service" "$stable_output")
assert_version "3.0.0" "$stable_version"

echo ""
echo "=== All stable graduation tests passed ==="
