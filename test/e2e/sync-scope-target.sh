#!/bin/bash
# E2E test for sync versioning with scope-based target filtering
# This test catches the regression where --target @scope/* would match packages
# outside config.packages, causing wrong version sources to be selected

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/helpers.sh"

trap cleanup_repo EXIT

echo "=== E2E: Sync Versioning with Scope Target Filter ==="

cd "$SCRIPT_DIR"

# Test: Sync versioning with scope target should only version config packages
echo ""
echo "--- Test: Sync with scope target respects config.packages boundary ---"
create_git_repo

# Create monorepo with 4 packages:
# - 2 managed packages (pkg-managed-a, pkg-managed-b) in config.packages
# - 2 internal packages (pkg-internal-c, pkg-internal-d) NOT in config.packages but matching @test/*
mkdir -p packages/managed-a packages/managed-b packages/internal-c packages/internal-d

cat > package.json <<EOF
{
  "name": "test-monorepo",
  "version": "0.18.0",
  "private": true
}
EOF

cat > pnpm-workspace.yaml <<EOF
packages:
  - 'packages/*'
EOF

cat > packages/managed-a/package.json <<EOF
{
  "name": "@test/managed-a",
  "version": "0.18.0"
}
EOF

cat > packages/managed-b/package.json <<EOF
{
  "name": "@test/managed-b",
  "version": "0.18.0"
}
EOF

# Internal packages with intentionally wrong versions (to detect if they're included)
cat > packages/internal-c/package.json <<EOF
{
  "name": "@test/internal-c",
  "version": "0.0.0",
  "private": true
}
EOF

cat > packages/internal-d/package.json <<EOF
{
  "name": "@test/internal-d",
  "version": "0.0.0",
  "private": true
}
EOF

# Config only includes the 2 managed packages
create_releasekit_config '{
  "version": {
    "preset": "conventionalcommits",
    "packages": ["packages/managed-a", "packages/managed-b"],
    "sync": true
  }
}'

git_commit "chore: initial commit"
echo "change" > packages/managed-a/change.txt
git_commit "feat(managed-a): add feature to managed package"

# Run with --target @test/* (scope glob that matches all 4 packages)
# Should only version the 2 in config.packages, not the 2 internal ones
set +e
output=$(run_cli_json releasekit release --dry-run --json --target @test/* --project-dir "$REPO_DIR")
exit_code=$?
set -e

assert_exit_code 0 "$exit_code"

# Verify only managed-a and managed-b are in updates
managed_a_count=$(echo "$output" | jq '[.versionOutput.updates[]? | select(.packageName == "@test/managed-a")] | length')
managed_b_count=$(echo "$output" | jq '[.versionOutput.updates[]? | select(.packageName == "@test/managed-b")] | length')
internal_c_count=$(echo "$output" | jq '[.versionOutput.updates[]? | select(.packageName == "@test/internal-c")] | length')
internal_d_count=$(echo "$output" | jq '[.versionOutput.updates[]? | select(.packageName == "@test/internal-d")] | length')

if [[ "$managed_a_count" != "1" ]]; then
  echo "FAIL: Expected @test/managed-a to be in updates"
  exit 1
fi
echo "PASS: @test/managed-a is in updates"

if [[ "$managed_b_count" != "1" ]]; then
  echo "FAIL: Expected @test/managed-b to be in updates"
  exit 1
fi
echo "PASS: @test/managed-b is in updates"

if [[ "$internal_c_count" != "0" ]]; then
  echo "FAIL: @test/internal-c should NOT be in updates (not in config.packages)"
  exit 1
fi
echo "PASS: @test/internal-c correctly excluded"

if [[ "$internal_d_count" != "0" ]]; then
  echo "FAIL: @test/internal-d should NOT be in updates (not in config.packages)"
  exit 1
fi
echo "PASS: @test/internal-d correctly excluded"

# Verify version was bumped correctly (should be 0.19.0, not 0.1.0)
version=$(echo "$output" | jq -r '.versionOutput.updates[0].newVersion')
assert_version "0.19.0" "$version"

echo ""
echo "=== All sync scope target tests passed ==="
