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
  git init
  git config user.email "test@test.com"
  git config user.name "Test User"
}

git_commit() {
  local message="$1"
  echo "$message" > ".commit-$(date +%s)"
  git add -A
  git commit -m "$message"
}

create_package_json() {
  local name="$1"
  local version="$2"
  cat > package.json <<EOF
{
  "name": "$name",
  "version": "$version",
  "private": true
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
  local pkg_name="${cmd#releasekit-}"
  
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
  local tmpfile
  tmpfile=$(mktemp)
  
  # Run CLI, capture stdout to temp file, stderr to /dev/null
  # The exit code is preserved
  run_cli "$cmd" "$@" > "$tmpfile" 2>/dev/null
  local exit_code=$?
  
  # Output the entire file (JSON may be multi-line)
  cat "$tmpfile"
  rm -f "$tmpfile"
  
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
