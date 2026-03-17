#!/bin/bash
# E2E tests for sync versioning strategy (monorepo with sync versions)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/helpers.sh"

trap cleanup_repo EXIT

echo "=== E2E: Sync Strategy Tests ==="

cd "$SCRIPT_DIR"

# Test: Sync versioning generates changelog
echo ""
echo "--- Test: Sync versioning generates changelog ---"
create_git_repo

# Create monorepo with 2 packages
mkdir -p packages/pkg-a packages/pkg-b

cat > package.json <<EOF
{
  "name": "test-monorepo-sync",
  "version": "0.1.0",
  "private": true
}
EOF

cat > pnpm-workspace.yaml <<EOF
packages:
  - 'packages/*'
EOF

cat > packages/pkg-a/package.json <<EOF
{
  "name": "@test/pkg-a",
  "version": "0.1.0",
  "private": true
}
EOF

cat > packages/pkg-b/package.json <<EOF
{
  "name": "@test/pkg-b",
  "version": "0.1.0",
  "private": true
}
EOF

create_releasekit_config '{"version":{"preset":"conventionalcommits","packages":["packages/*"],"sync":true}}'
git_commit "chore: initial commit"
git_commit "feat: add awesome feature"

set +e
output=$(run_cli_json releasekit-version --dry-run --json)
set -e

# Verify version
version=$(echo "$output" | jq -r '.updates[0].newVersion')
assert_version "0.2.0" "$version"

# Verify changelog is generated
changelog_count=$(echo "$output" | jq '.changelogs | length')
if [[ "$changelog_count" == "0" ]]; then
  echo "FAIL: Expected changelog to be generated, but changelogs array is empty"
  echo "Output: $output"
  exit 1
fi
echo "PASS: Changelog generated"

# Verify changelog contains the feature
changelog_entry=$(echo "$output" | jq -r '.changelogs[0].entries[0].description')
if [[ "$changelog_entry" != *"awesome feature"* ]]; then
  echo "FAIL: Expected changelog to contain 'awesome feature', got: $changelog_entry"
  exit 1
fi
echo "PASS: Changelog contains feature description"

echo ""
echo "=== All sync strategy tests passed ==="
