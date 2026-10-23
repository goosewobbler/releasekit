#!/bin/bash
# E2E tests for version.preset: the default loads, and an unsupported preset is a config error

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/helpers.sh"

trap cleanup_repo EXIT

echo "=== E2E: Preset Tests ==="

setup_preset_repo() {
  local config_json="$1"
  local tagged="$2"
  create_git_repo
  create_package_json "test-preset" "1.0.0"
  create_releasekit_config "$config_json"
  git_commit "chore: initial commit"
  if [[ "$tagged" == "tagged" ]]; then
    git tag "v1.0.0"
  fi
  git_commit "feat!: drop legacy API"
}

assert_preset_config_error() {
  local envelope="$1"
  local stderr_file="$2"
  local code
  code=$(echo "$envelope" | jq -r '.errors[0].code // empty')
  if [[ "$code" != "CONFIG_ERROR" ]]; then
    echo "FAIL: Expected a CONFIG_ERROR envelope, got: $envelope"
    exit 1
  fi
  echo "PASS: CONFIG_ERROR envelope"
  assert_contains "$(echo "$envelope" | jq -r '.errors[0].message')" '"angular"|"conventionalcommits"'
  if grep -qE 'Unhandled|node:internal|^Node\.js v' "$stderr_file"; then
    echo "FAIL: Node crash output on stderr"
    cat "$stderr_file"
    exit 1
  fi
  echo "PASS: No crash output on stderr"
}

# Test 1: no preset on a tagged repo → conventionalcommits (only it parses the `!` marker as breaking)
echo ""
echo "--- Test: tagged repo without a preset uses conventionalcommits ---"
setup_preset_repo '{"version":{"packages":["./"]}}' tagged

set +e
output=$(run_cli_json releasekit release --dry-run --json --project-dir "$REPO_DIR")
exit_code=$?
set -e

assert_exit_code 0 "$exit_code"
assert_version "2.0.0" "$(get_version_from_json "$output")"

cleanup_repo
REPO_DIR=""

# Test 2: unsupported preset on a tagged repo → CONFIG_ERROR envelope on stdout, exit 2
echo ""
echo "--- Test: unsupported preset (tagged) fails release with CONFIG_ERROR on stdout ---"
setup_preset_repo '{"version":{"preset":"nonsense","packages":["./"]}}' tagged
stderr_file=$(mktemp)

set +e
output=$(run_cli releasekit release --dry-run --json --project-dir "$REPO_DIR" 2>"$stderr_file")
exit_code=$?
set -e

assert_exit_code 2 "$exit_code"
assert_preset_config_error "$output" "$stderr_file"

cleanup_repo
REPO_DIR=""

# Test 3: unsupported preset on an untagged repo → CONFIG_ERROR envelope in --output, exit 2
echo ""
echo "--- Test: unsupported preset (untagged) fails release with CONFIG_ERROR in --output ---"
setup_preset_repo '{"version":{"preset":"nonsense","packages":["./"]}}' untagged
output_file=$(mktemp)

set +e
stdout=$(run_cli releasekit release --dry-run --json --output "$output_file" --project-dir "$REPO_DIR" 2>"$stderr_file")
exit_code=$?
set -e

assert_exit_code 2 "$exit_code"
if [[ -n "$stdout" ]]; then
  echo "FAIL: Expected empty stdout with --output, got: $stdout"
  exit 1
fi
assert_preset_config_error "$(cat "$output_file")" "$stderr_file"

cleanup_repo
REPO_DIR=""

# Test 4: standing-pr update reports the same CONFIG_ERROR
echo ""
echo "--- Test: unsupported preset fails standing-pr update with CONFIG_ERROR in --output ---"
setup_preset_repo '{"version":{"preset":"nonsense","packages":["./"]}}' tagged

set +e
run_cli releasekit standing-pr update --json --output "$output_file" --project-dir "$REPO_DIR" >/dev/null 2>"$stderr_file"
exit_code=$?
set -e

assert_exit_code 2 "$exit_code"
assert_preset_config_error "$(cat "$output_file")" "$stderr_file"

rm -f "$stderr_file" "$output_file"

echo ""
echo "=== All preset tests passed ==="
