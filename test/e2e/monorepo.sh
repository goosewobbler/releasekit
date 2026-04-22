#!/bin/bash
# E2E tests for monorepo CLI

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/helpers.sh"

trap cleanup_repo EXIT

echo "=== E2E: Monorepo Tests ==="

cd "$SCRIPT_DIR"

create_monorepo_packages() {
  mkdir -p packages/pkg-a packages/pkg-b
  
  cat > package.json <<EOF
{
  "name": "test-monorepo",
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
  "version": "0.1.0"
}
EOF

   cat > packages/pkg-b/package.json <<EOF
{
  "name": "@test/pkg-b",
  "version": "0.1.0"
}
EOF
}

# Test: sync versioning
echo ""
echo "--- Test: sync versioning ---"
create_git_repo
create_monorepo_packages
create_releasekit_config '{"version":{"preset":"conventionalcommits","packages":["packages/*"],"sync":true}}'
git_commit "chore: initial commit"
git_commit "feat: add feature"

set +e
output=$(run_cli_json releasekit release --dry-run --json --project-dir "$REPO_DIR")
exit_code=$?
set -e

assert_exit_code 0 "$exit_code"

version_a=$(echo "$output" | jq -r '.versionOutput.updates[0].newVersion')
version_b=$(echo "$output" | jq -r '.versionOutput.updates[1].newVersion')

assert_version "0.2.0" "$version_a"
assert_version "0.2.0" "$version_b"

# Sync mode with a shared tag: updates must NOT carry individual tags (batch push mode)
assert_update_has_no_tag "@test/pkg-a" "$output"
assert_update_has_no_tag "@test/pkg-b" "$output"

echo ""
echo "=== All monorepo tests passed ==="
