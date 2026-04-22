#!/bin/bash
# E2E tests for prerelease → stable graduation lifecycle

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/helpers.sh"

trap cleanup_repo EXIT

echo "=== E2E: Stable Graduation Tests ==="

setup_prerelease_repo() {
  create_git_repo

  mkdir -p packages/{core-spy,platform-service,runtime-service}

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

  cat > packages/core-spy/package.json <<'EOF'
{
  "name": "@test/core-spy",
  "version": "1.0.0"
}
EOF

  cat > packages/platform-service/package.json <<'EOF'
{
  "name": "@test/platform-service",
  "version": "2.0.0"
}
EOF

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
  }
}
EOF

  git_commit "chore: initial commit"
  # sanitizePackageName strips @ prefix and replaces / with -
  git tag "test-core-spy@v1.0.0"
  git tag "test-platform-service@v2.0.0"
  git tag "test-runtime-service@v3.0.0-next.0"
}

# Test 1: --stable graduates prerelease package to stable
echo ""
echo "--- Test: --stable graduates 3.0.0-next.0 to 3.0.0 ---"
setup_prerelease_repo
echo "feat" > packages/runtime-service/feat.txt
git_commit "feat: add runtime capability"

set +e
output=$(run_cli_json releasekit release --dry-run --json --stable --target '@test/runtime-service' --project-dir "$REPO_DIR")
exit_code=$?
set -e

assert_exit_code 0 "$exit_code"
assert_updated "@test/runtime-service" "$output"
assert_not_updated "@test/core-spy" "$output"
assert_not_updated "@test/platform-service" "$output"

version=$(get_updated_version "@test/runtime-service" "$output")
assert_version "3.0.0" "$version"

cleanup_repo
REPO_DIR=""

# Test 2: Prerelease then graduation (full lifecycle in dry-run)
echo ""
echo "--- Test: prepatch creates prerelease, --stable graduates it ---"
setup_prerelease_repo

# Simulate a package going from stable to prerelease
echo "fix" > packages/core-spy/fix.txt
git_commit "fix: fix spy mock reset"

set +e
pre_output=$(run_cli_json releasekit release --dry-run --json --bump prepatch --target '@test/core-spy' --project-dir "$REPO_DIR")
pre_exit=$?
set -e

assert_exit_code 0 "$pre_exit"
pre_version=$(get_updated_version "@test/core-spy" "$pre_output")
if [[ "$pre_version" != *"next"* ]]; then
  echo "FAIL: Expected prerelease version with 'next', got $pre_version"
  exit 1
fi
echo "PASS: Prepatch produced prerelease version: $pre_version"

echo "feat" > packages/runtime-service/feat.txt
git_commit "feat: add runtime capability"

# Now verify that a package already at prerelease can be graduated
# runtime-service is at 3.0.0-next.0, --stable should produce 3.0.0
set +e
stable_output=$(run_cli_json releasekit release --dry-run --json --stable --target '@test/runtime-service' --project-dir "$REPO_DIR")
stable_exit=$?
set -e

assert_exit_code 0 "$stable_exit"
stable_version=$(get_updated_version "@test/runtime-service" "$stable_output")
assert_version "3.0.0" "$stable_version"

echo ""
echo "=== All stable graduation tests passed ==="
