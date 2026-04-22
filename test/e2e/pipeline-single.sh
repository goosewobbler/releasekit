#!/bin/bash
# E2E tests for full release pipeline via unified releasekit release CLI

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/helpers.sh"

trap cleanup_repo EXIT

echo "=== E2E: Pipeline Single Package Tests ==="

# Test: Full pipeline with feat commit via unified CLI
echo ""
echo "--- Test: releasekit release --dry-run (version + notes in one step) ---"
create_git_repo
create_package_json "test-pipeline-single" "0.1.0"
create_releasekit_config '{"version":{"preset":"conventionalcommits","packages":["./"]}}'
git_commit "chore: initial commit"
git_commit "feat: add awesome feature"

set +e
output=$(run_cli_json releasekit release --dry-run --json --project-dir "$REPO_DIR")
exit_code=$?
set -e

assert_exit_code 0 "$exit_code"
version=$(get_version_from_json "$output")
assert_version "0.2.0" "$version"

notes_generated=$(echo "$output" | jq -r '.notesGenerated')
if [[ "$notes_generated" != "true" ]]; then
  echo "FAIL: Expected notesGenerated=true in pipeline output, got: $notes_generated"
  exit 1
fi
echo "PASS: Pipeline ran version and notes in a single step"

cleanup_repo
REPO_DIR=""

# Test: Fix commit goes through pipeline correctly
echo ""
echo "--- Test: fix commit pipeline produces patch bump ---"
create_git_repo
create_package_json "test-pipeline-fix" "1.0.0"
create_releasekit_config '{"version":{"preset":"conventionalcommits","packages":["./"]}}'
git_commit "chore: initial commit"
git_commit "fix: correct output formatting"

set +e
output=$(run_cli_json releasekit release --dry-run --json --project-dir "$REPO_DIR")
exit_code=$?
set -e

assert_exit_code 0 "$exit_code"
version=$(get_version_from_json "$output")
assert_version "1.0.1" "$version"
echo "PASS: Fix commit pipeline produces patch bump"

echo ""
echo "=== All pipeline single tests passed ==="
