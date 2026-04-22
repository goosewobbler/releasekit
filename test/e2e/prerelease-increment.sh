#!/bin/bash
# E2E tests for prerelease incrementing

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/helpers.sh"

trap cleanup_repo EXIT

echo "=== E2E: Prerelease Increment Tests ==="

# Test: Increment existing prerelease version
echo ""
echo "--- Test: Increment existing prerelease version ---"
create_git_repo
create_package_json "test-prerelease-increment" "1.0.0-next.6"
create_releasekit_config '{"version":{"preset":"conventionalcommits","packages":["./"]}}'

# Create initial commit and tag
git_commit "chore: initial commit"
git tag "v1.0.0-next.6"

# Make a commit that would normally trigger a version bump
git_commit "feat: add new feature"

set +e
output=$(run_cli_json releasekit release --dry-run --json --bump prerelease --project-dir "$REPO_DIR")
exit_code=$?
set -e

assert_exit_code 0 "$exit_code"
version=$(get_version_from_json "$output")

# Prerelease version should be incremented to 1.0.0-next.7
assert_version "1.0.0-next.7" "$version"

echo ""
echo "=== All prerelease increment tests passed ==="
