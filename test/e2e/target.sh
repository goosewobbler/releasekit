#!/bin/bash
# E2E tests for --target flag
# NOTE: This test verifies the --target flag is accepted and filters output.
# There appears to be a bug in async strategy version calculation that may
# cause incorrect version bumps when targeting specific packages.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/helpers.sh"

trap cleanup_repo EXIT

echo "=== E2E: Target Flag Tests ==="

cd "$SCRIPT_DIR"

create_target_monorepo() {
  mkdir -p packages/pkg-a packages/pkg-b
  
  cat > package.json <<EOF
{
  "name": "test-monorepo-target",
  "version": "1.0.0",
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
}

# Test: Target single package - verify flag is accepted
echo ""
echo "--- Test: Target single package ---"
create_git_repo
create_target_monorepo
create_releasekit_config '{"version":{"preset":"conventionalcommits","packages":["packages/*"]}}'
git_commit "chore: initial commit"

# Make changes to both packages
echo "change" > packages/pkg-a/change.txt
git_commit "feat(pkg-a): add feature to pkg-a"
echo "change" > packages/pkg-b/change.txt
git_commit "fix(pkg-b): fix bug in pkg-b"

# Target only pkg-b
set +e
output=$(run_cli_json releasekit-version --dry-run --json --target @test/pkg-b)
exit_code=$?
set -e

assert_exit_code 0 "$exit_code"

# Verify only pkg-b is in the output (pkg-a should not be present)
pkg_a_count=$(echo "$output" | jq '[.updates[] | select(.packageName == "@test/pkg-a")] | length')
pkg_b_count=$(echo "$output" | jq '[.updates[] | select(.packageName == "@test/pkg-b")] | length')

if [[ "$pkg_a_count" != "0" ]]; then
  echo "FAIL: pkg-a should not be in output when targeting pkg-b"
  exit 1
fi
echo "PASS: pkg-a not in output when targeting pkg-b"

if [[ "$pkg_b_count" != "1" ]]; then
  echo "FAIL: Expected pkg-b to be in output once"
  exit 1
fi
echo "PASS: pkg-b is in output"

echo ""
echo "=== All target flag tests passed ==="
