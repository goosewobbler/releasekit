#!/bin/bash
# E2E tests for the unified releasekit release CLI

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/helpers.sh"

trap cleanup_repo EXIT

echo "=== E2E: Unified Release CLI Tests ==="

cd "$SCRIPT_DIR"

# Test: Full release pipeline dry-run with feat commit
echo ""
echo "--- Test: releasekit release --dry-run --json (single package) ---"
create_git_repo
create_package_json "test-release-single" "0.1.0"
create_releasekit_config '{"version":{"preset":"angular","packages":["./"]}}'
git_commit "chore: initial commit"
git_commit "feat: add new feature"

release_output=$(run_cli_json releasekit release --dry-run --json --project-dir "$REPO_DIR")
release_exit=$?

assert_exit_code 0 "$release_exit"

version=$(echo "$release_output" | jq -r '.versionOutput.updates[0].newVersion')
assert_version "0.2.0" "$version"

notes_generated=$(echo "$release_output" | jq -r '.notesGenerated')
assert_contains "$notes_generated" "true"

echo "PASS: Unified release CLI dry-run succeeded"

cleanup_repo
REPO_DIR=""

# Test: No changes returns null (exit 0)
echo ""
echo "--- Test: releasekit release --dry-run with no releasable changes ---"
create_git_repo
create_package_json "test-release-no-changes" "0.1.0"
create_releasekit_config '{"version":{"preset":"angular","packages":["./"]}}'
git_commit "chore: initial commit"

# Only a chore commit — no version bump expected
set +e
release_output=$(run_cli releasekit release --dry-run --json --project-dir "$REPO_DIR" 2>&1)
release_exit=$?
set -e

assert_exit_code 0 "$release_exit"
echo "PASS: No changes exits cleanly"

cleanup_repo
REPO_DIR=""

# Test: Fix commit produces patch bump
echo ""
echo "--- Test: fix commit produces patch bump ---"
create_git_repo
create_package_json "test-release-fix" "1.0.0"
create_releasekit_config '{"version":{"preset":"angular","packages":["./"]}}'
git_commit "chore: initial commit"
git_commit "fix: resolve edge case"

release_output=$(run_cli_json releasekit release --dry-run --json --project-dir "$REPO_DIR")
release_exit=$?

assert_exit_code 0 "$release_exit"

version=$(echo "$release_output" | jq -r '.versionOutput.updates[0].newVersion')
assert_version "1.0.1" "$version"

echo "PASS: Fix commit produces patch bump"

echo ""
echo "=== All unified release CLI tests passed ==="
