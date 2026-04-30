#!/bin/bash
# E2E tests for pure Rust and hybrid packages with --target

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/helpers.sh"

trap cleanup_repo EXIT

echo "=== E2E: Rust Package Target Tests ==="

cd "$SCRIPT_DIR"

# Test 1: Pure Rust package (Cargo.toml only) is versioned when explicitly targeted
echo ""
echo "--- Test: Pure Rust package (Cargo.toml only) targeted via --target ---"
create_git_repo

cat > package.json <<EOF
{
  "name": "test-rust-workspace",
  "version": "0.0.1",
  "private": true
}
EOF

cat > pnpm-workspace.yaml <<EOF
packages:
  - 'packages/*'
EOF

# One npm package so the workspace is valid
mkdir -p packages/lib
cat > packages/lib/package.json <<EOF
{
  "name": "@test/lib",
  "version": "0.1.0"
}
EOF

# Pure Rust crate — no package.json
mkdir -p crates/my-crate
cat > crates/my-crate/Cargo.toml <<EOF
[package]
name = "my-crate"
version = "0.1.0"
edition = "2021"
EOF

create_releasekit_config '{"version":{"preset":"conventionalcommits","packages":["crates/my-crate"]}}'
git_commit "chore: initial commit"

echo "change" > crates/my-crate/change.txt
git_commit "feat: add feature to my-crate"

set +e
output=$(run_cli_json releasekit release --dry-run --json --target my-crate --project-dir "$REPO_DIR")
exit_code=$?
set -e

assert_exit_code 0 "$exit_code"
assert_updated "my-crate" "$output"

file_path=$(echo "$output" | jq -r '.versionOutput.updates[] | select(.packageName == "my-crate") | .filePath')
if [[ "$file_path" != *"Cargo.toml" ]]; then
  echo "FAIL: Expected filePath to end with Cargo.toml, got: $file_path"
  exit 1
fi
echo "PASS: my-crate update has filePath ending in Cargo.toml"

assert_not_updated "@test/lib" "$output"

# Test 2: Hybrid package (package.json private:true + Cargo.toml) is versioned when targeted
echo ""
echo "--- Test: Hybrid package (private npm + Cargo.toml) targeted via --target ---"
create_git_repo

cat > package.json <<EOF
{
  "name": "test-hybrid-workspace",
  "version": "0.0.1",
  "private": true
}
EOF

cat > pnpm-workspace.yaml <<EOF
packages:
  - 'packages/*'
EOF

mkdir -p packages/hybrid-pkg
cat > packages/hybrid-pkg/package.json <<EOF
{
  "name": "@test/hybrid-pkg",
  "version": "0.1.0",
  "private": true
}
EOF

cat > packages/hybrid-pkg/Cargo.toml <<EOF
[package]
name = "hybrid-pkg"
version = "0.1.0"
edition = "2021"
EOF

create_releasekit_config '{"version":{"preset":"conventionalcommits","packages":["packages/hybrid-pkg"]}}'
git_commit "chore: initial commit"

echo "change" > packages/hybrid-pkg/change.txt
git_commit "feat: add hybrid feature"

set +e
output=$(run_cli_json releasekit release --dry-run --json --target @test/hybrid-pkg --project-dir "$REPO_DIR")
exit_code=$?
set -e

assert_exit_code 0 "$exit_code"
assert_updated "@test/hybrid-pkg" "$output"
echo "PASS: hybrid package with private:true in package.json is included when explicitly targeted"

echo ""
echo "=== All Rust target tests passed ==="
