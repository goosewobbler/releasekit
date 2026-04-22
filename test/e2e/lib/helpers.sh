#!/bin/bash
# Shared helper functions for E2E tests

set -euo pipefail

REPO_DIR=""

# RELEASEKIT_ROOT is set by the isolation script, or detected from script location
if [[ -z "${RELEASEKIT_ROOT:-}" ]]; then
  # Running from repo root - detect from script location
  RELEASEKIT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
fi

cleanup_repo() {
  if [[ -n "$REPO_DIR" && -d "$REPO_DIR" ]]; then
    rm -rf "$REPO_DIR"
  fi
}

create_git_repo() {
  REPO_DIR=$(mktemp -d)
  cd "$REPO_DIR"
  git init -q -b main
  git config user.email "test@test.com"
  git config user.name "Test User"
}

git_commit() {
  local message="$1"
  echo "$message" > ".commit-$(date +%s)"
  git add -A
  git commit -q -m "$message"
}

create_package_json() {
  local name="$1"
  local version="$2"
  cat > package.json <<EOF
{
  "name": "$name",
  "version": "$version"
}
EOF
}

create_releasekit_config() {
  local config_json="$1"
  cat > releasekit.config.json <<EOF
$config_json
EOF
}

run_cli() {
  local cmd="$1"
  shift

  # Map command name to package name
  local pkg_name
  if [[ "$cmd" == "releasekit" ]]; then
    pkg_name="release"
  else
    pkg_name="${cmd#releasekit-}"
  fi

  if [[ -d "$RELEASEKIT_ROOT/packages/$pkg_name" ]]; then
    # Running from repo root
    node "$RELEASEKIT_ROOT/packages/$pkg_name/dist/cli.js" "$@"
  else
    # Running in isolated environment (node_modules)
    node "$RELEASEKIT_ROOT/@releasekit/$pkg_name/dist/cli.js" "$@"
  fi
}

run_cli_json() {
  local cmd="$1"
  shift
  local tmpfile stderrfile
  tmpfile=$(mktemp)
  stderrfile=$(mktemp)

  # Run CLI, capture stdout to temp file, stderr to separate file
  # The exit code is preserved
  run_cli "$cmd" "$@" > "$tmpfile" 2>"$stderrfile"
  local exit_code=$?

  if [ $exit_code -ne 0 ] && [ -s "$stderrfile" ]; then
    echo "CLI stderr:" >&2
    cat "$stderrfile" >&2
  fi

  # Output the JSON (stdout only)
  cat "$tmpfile"
  rm -f "$tmpfile" "$stderrfile"

  return $exit_code
}

assert_exit_code() {
  local expected="$1"
  local actual="$2"
  if [[ "$expected" != "$actual" ]]; then
    echo "FAIL: Expected exit code $expected, got $actual"
    exit 1
  fi
  echo "PASS: Exit code is $actual"
}

assert_version() {
  local expected="$1"
  local actual="$2"
  if [[ "$expected" != "$actual" ]]; then
    echo "FAIL: Expected version $expected, got $actual"
    exit 1
  fi
  echo "PASS: Version is $actual"
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  if [[ "$haystack" != *"$needle"* ]]; then
    echo "FAIL: Expected output to contain '$needle'"
    echo "Output: $haystack"
    exit 1
  fi
  echo "PASS: Output contains '$needle'"
}

assert_updated() {
  local pkg="$1"
  local json="$2"
  local count
  count=$(echo "$json" | jq --arg pkg "$pkg" '[.versionOutput.updates[]? | select(.packageName == $pkg)] | length') || {
    echo "FAIL: Failed to parse JSON for '$pkg' updates check"
    exit 1
  }
  if [[ "$count" == "0" ]]; then
    echo "FAIL: Expected '$pkg' to be in updates, but it was not"
    echo "Updates: $(echo "$json" | jq '.versionOutput.updates')"
    exit 1
  fi
  echo "PASS: '$pkg' is in updates"
}

assert_not_updated() {
  local pkg="$1"
  local json="$2"
  local count
  count=$(echo "$json" | jq --arg pkg "$pkg" '[.versionOutput.updates[]? | select(.packageName == $pkg)] | length') || {
    echo "FAIL: Failed to parse JSON for '$pkg' updates check"
    exit 1
  }
  if [[ "$count" != "0" ]]; then
    echo "FAIL: Expected '$pkg' NOT to be in updates, but it was"
    echo "Updates: $(echo "$json" | jq '.versionOutput.updates')"
    exit 1
  fi
  echo "PASS: '$pkg' not in updates"
}

get_updated_version() {
  local pkg="$1"
  local json="$2"
  echo "$json" | jq -r --arg pkg "$pkg" '.versionOutput.updates[]? | select(.packageName == $pkg) | .newVersion'
}

assert_tag_contains() {
  local pattern="$1"
  local json="$2"
  local found
  found=$(echo "$json" | jq -r --arg pat "$pattern" '.versionOutput.tags[]? | select(test($pat))' | head -1)
  if [[ -z "$found" ]]; then
    echo "FAIL: Expected tags to match pattern '$pattern'"
    echo "Tags: $(echo "$json" | jq '.versionOutput.tags')"
    exit 1
  fi
  echo "PASS: Tags contain '$found' (matched '$pattern')"
}

assert_tag_not_contains() {
  local pattern="$1"
  local json="$2"
  local found
  found=$(echo "$json" | jq -r --arg pat "$pattern" '.versionOutput.tags[]? | select(test($pat))' | head -1)
  if [[ -n "$found" ]]; then
    echo "FAIL: Expected tags NOT to match pattern '$pattern', but found '$found'"
    exit 1
  fi
  echo "PASS: Tags do not contain pattern '$pattern'"
}

get_version_from_json() {
  local json="$1"
  echo "$json" | jq -r '.versionOutput.updates[0].newVersion // empty'
}
