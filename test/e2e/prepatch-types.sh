#!/bin/bash
# E2E tests for pre* bump types: prepatch, preminor, premajor
# These bump types are produced by the releasekit gate when release:prerelease + bump:* labels are combined

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/helpers.sh"

trap cleanup_repo EXIT

echo "=== E2E: Pre-Bump Type Tests ==="

setup_single_package_repo() {
  create_git_repo
  mkdir -p packages/core-spy
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
  cat > releasekit.config.json <<'EOF'
{
  "version": {
    "preset": "angular",
    "sync": false,
    "packageSpecificTags": true,
    "tagTemplate": "${packageName}@v${version}",
    "prereleaseIdentifier": "next",
    "packages": ["packages/*"]
  }
}
EOF
  git_commit "chore: initial commit"
  # sanitizePackageName strips @ prefix and replaces / with -
  git tag "test-core-spy@v1.0.0"
}

# Test 1: --bump prepatch → 1.0.1-next.0 (patch prerelease using config identifier)
echo ""
echo "--- Test: --bump prepatch produces patch prerelease ---"
setup_single_package_repo
git_commit "fix: resolve edge case"

set +e
output=$(run_cli_json releasekit release --dry-run --json --bump prepatch --target '@test/core-spy' --project-dir "$REPO_DIR")
exit_code=$?
set -e

assert_exit_code 0 "$exit_code"
version=$(get_updated_version "@test/core-spy" "$output")
assert_version "1.0.1-next.0" "$version"

cleanup_repo
REPO_DIR=""

# Test 2: --bump preminor → 1.1.0-next.0 (minor prerelease using config identifier)
echo ""
echo "--- Test: --bump preminor produces minor prerelease ---"
setup_single_package_repo
git_commit "feat: add new spy capability"

set +e
output=$(run_cli_json releasekit release --dry-run --json --bump preminor --target '@test/core-spy' --project-dir "$REPO_DIR")
exit_code=$?
set -e

assert_exit_code 0 "$exit_code"
version=$(get_updated_version "@test/core-spy" "$output")
assert_version "1.1.0-next.0" "$version"

cleanup_repo
REPO_DIR=""

# Test 3: --bump premajor → 2.0.0-next.0 (major prerelease using config identifier)
echo ""
echo "--- Test: --bump premajor produces major prerelease ---"
setup_single_package_repo
git_commit "feat!: redesign spy API"

set +e
output=$(run_cli_json releasekit release --dry-run --json --bump premajor --target '@test/core-spy' --project-dir "$REPO_DIR")
exit_code=$?
set -e

assert_exit_code 0 "$exit_code"
version=$(get_updated_version "@test/core-spy" "$output")
assert_version "2.0.0-next.0" "$version"

echo ""
echo "=== All pre-bump type tests passed ==="
