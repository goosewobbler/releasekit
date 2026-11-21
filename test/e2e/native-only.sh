#!/bin/bash
# E2E tests for Rust-only and Dart-only repos (no package.json), using the docs/rust.md and docs/dart.md quickstarts

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/helpers.sh"

trap cleanup_repo EXIT

echo "=== E2E: Native-only Repo Tests ==="

cd "$SCRIPT_DIR"

# Test 1: Cargo workspace with two crates and no package.json
echo ""
echo "--- Test: Cargo workspace without package.json ---"
create_git_repo

cat > Cargo.toml <<EOF
[workspace]
members = ["crates/*"]
resolver = "2"
EOF

mkdir -p crates/core crates/cli
cat > crates/core/Cargo.toml <<EOF
[package]
name = "e2e-core"
version = "0.1.0"
edition = "2021"
EOF
cat > crates/cli/Cargo.toml <<EOF
[package]
name = "e2e-cli"
version = "0.1.0"
edition = "2021"
EOF

create_releasekit_config '{
  "$schema": "https://goosewobbler.github.io/releasekit/schema.json",
  "version": { "cargo": { "enabled": true } },
  "publish": { "cargo": { "enabled": true } }
}'
git_commit "chore: initial commit"
echo "change" > crates/core/change.txt
git_commit "feat: add feature to core"

set +e
output=$(run_cli_json releasekit release --dry-run --json --project-dir "$REPO_DIR")
exit_code=$?
set -e

assert_exit_code 0 "$exit_code"
assert_updated "e2e-core" "$output"
assert_updated "e2e-cli" "$output"
assert_version "0.2.0" "$(get_updated_version "e2e-core" "$output")"
assert_version "0.2.0" "$(get_updated_version "e2e-cli" "$output")"
assert_tag_contains '^v0\.2\.0$' "$output"

# Test 2: single Dart package and no package.json
echo ""
echo "--- Test: Dart package without package.json ---"
cleanup_repo
create_git_repo

cat > pubspec.yaml <<EOF
name: e2e_dart
version: 1.2.0
environment:
  sdk: ^3.0.0
EOF
mkdir -p lib
echo "// e2e" > lib/e2e_dart.dart

create_releasekit_config '{
  "$schema": "https://goosewobbler.github.io/releasekit/schema.json",
  "version": { "pub": { "enabled": true } },
  "publish": { "pub": { "enabled": true } }
}'
git_commit "chore: initial commit"
echo "// fix" >> lib/e2e_dart.dart
git_commit "fix: resolve bug"

set +e
output=$(run_cli_json releasekit release --dry-run --json --project-dir "$REPO_DIR")
exit_code=$?
set -e

assert_exit_code 0 "$exit_code"
assert_updated "e2e_dart" "$output"
assert_version "1.2.1" "$(get_updated_version "e2e_dart" "$output")"
assert_tag_contains '^v1\.2\.1$' "$output"

echo ""
echo "=== All native-only repo tests passed ==="
