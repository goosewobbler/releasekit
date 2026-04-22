#!/bin/bash
# E2E tests for angular preset commit type handling

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/helpers.sh"

trap cleanup_repo EXIT

echo "=== E2E: Angular Preset Tests ==="

setup_angular_repo() {
  create_git_repo
  create_package_json "test-angular" "1.0.0"
  create_releasekit_config '{"version":{"preset":"angular","packages":["./"]}}'
  git_commit "chore: initial commit"
  git tag "v1.0.0"
}

# Test 1: fix commit → patch bump
echo ""
echo "--- Test: fix commit produces patch bump ---"
setup_angular_repo
git_commit "fix(core): resolve null pointer exception"

set +e
output=$(run_cli_json releasekit release --dry-run --json --project-dir "$REPO_DIR")
exit_code=$?
set -e

assert_exit_code 0 "$exit_code"
version=$(get_version_from_json "$output")
assert_version "1.0.1" "$version"

cleanup_repo
REPO_DIR=""

# Test 2: feat commit → minor bump
echo ""
echo "--- Test: feat commit produces minor bump ---"
setup_angular_repo
git_commit "feat(service): add new API endpoint"

set +e
output=$(run_cli_json releasekit release --dry-run --json --project-dir "$REPO_DIR")
exit_code=$?
set -e

assert_exit_code 0 "$exit_code"
version=$(get_version_from_json "$output")
assert_version "1.1.0" "$version"

cleanup_repo
REPO_DIR=""

# Test 3: breaking change → major bump (angular preset uses BREAKING CHANGE footer, not !)
echo ""
echo "--- Test: breaking change produces major bump ---"
setup_angular_repo
# angular preset recognizes BREAKING CHANGE in commit footer, not ! suffix
echo "break" > .break
git add -A
git commit -q -m $'feat: redesign public API\n\nBREAKING CHANGE: API completely changed'

set +e
output=$(run_cli_json releasekit release --dry-run --json --project-dir "$REPO_DIR")
exit_code=$?
set -e

assert_exit_code 0 "$exit_code"
version=$(get_version_from_json "$output")
assert_version "2.0.0" "$version"

cleanup_repo
REPO_DIR=""

# Test 4: perf commit → patch bump (performance fixes are patch-level in angular preset)
echo ""
echo "--- Test: perf commit produces patch bump ---"
setup_angular_repo
git_commit "perf(renderer): optimize frame rendering"

set +e
output=$(run_cli_json releasekit release --dry-run --json --project-dir "$REPO_DIR")
exit_code=$?
set -e

assert_exit_code 0 "$exit_code"
version=$(get_version_from_json "$output")
assert_version "1.0.1" "$version"

echo ""
echo "=== All angular preset tests passed ==="
