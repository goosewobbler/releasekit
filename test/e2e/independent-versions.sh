#!/bin/bash
# E2E tests for independent versioning (sync:false) with packages at different baselines

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/helpers.sh"

trap cleanup_repo EXIT

echo "=== E2E: Independent Versions Tests ==="

setup_mixed_versions_repo() {
  create_git_repo

  mkdir -p packages/{platform-service,platform-bridge,runtime-service}

  cat > package.json <<'EOF'
{
  "name": "scoped-monorepo-fixture",
  "version": "0.0.0",
  "private": true
}
EOF

  cat > pnpm-workspace.yaml <<'EOF'
packages:
  - 'packages/*'
EOF

  cat > packages/platform-service/package.json <<'EOF'
{
  "name": "@test/platform-service",
  "version": "2.0.0"
}
EOF

  cat > packages/platform-bridge/package.json <<'EOF'
{
  "name": "@test/platform-bridge",
  "version": "2.0.0"
}
EOF

  cat > packages/runtime-service/package.json <<'EOF'
{
  "name": "@test/runtime-service",
  "version": "3.0.0-next.0"
}
EOF

  cat > releasekit.config.json <<'EOF'
{
  "version": {
    "preset": "angular",
    "sync": false,
    "packageSpecificTags": true,
    "tagTemplate": "${packageName}@v${version}",
    "prereleaseIdentifier": "next",
    "mismatchStrategy": "prefer-package",
    "packages": ["packages/*"]
  }
}
EOF

  git_commit "chore: initial commit"
  # sanitizePackageName strips @ prefix and replaces / with -
  git tag "test-platform-service@v2.0.0"
  git tag "test-platform-bridge@v2.0.0"
  git tag "test-runtime-service@v3.0.0-next.0"
}

# Test 1: Targeting platform-service bumps from 2.0.0, not affecting runtime at 3.x
echo ""
echo "--- Test: platform-service bumps independently from 2.0.0 ---"
setup_mixed_versions_repo
echo "fix" > packages/platform-service/fix.txt
git_commit "fix: fix platform service startup"

set +e
output=$(run_cli_json releasekit release --dry-run --json --target '@test/platform-service' --project-dir "$REPO_DIR")
exit_code=$?
set -e

assert_exit_code 0 "$exit_code"
assert_updated "@test/platform-service" "$output"
assert_not_updated "@test/platform-bridge" "$output"
assert_not_updated "@test/runtime-service" "$output"

version=$(get_updated_version "@test/platform-service" "$output")
assert_version "2.0.1" "$version"

# In async/independent mode each update must carry its own tag (per-package push mode)
assert_update_has_tag "@test/platform-service" "$(get_update_tag "@test/platform-service" "$output")" "$output"

cleanup_repo
REPO_DIR=""

# Test 2: Targeting both platform packages bumps them from their shared 2.x baseline
echo ""
echo "--- Test: platform-* bumps independently from runtime 3.x ---"
setup_mixed_versions_repo
echo "feat" > packages/platform-service/feat.txt
echo "feat" > packages/platform-bridge/feat.txt
git_commit "feat: add platform bridge method"

set +e
output=$(run_cli_json releasekit release --dry-run --json --target '@test/platform-*' --project-dir "$REPO_DIR")
exit_code=$?
set -e

assert_exit_code 0 "$exit_code"
assert_updated "@test/platform-service" "$output"
assert_updated "@test/platform-bridge" "$output"
assert_not_updated "@test/runtime-service" "$output"

service_version=$(get_updated_version "@test/platform-service" "$output")
bridge_version=$(get_updated_version "@test/platform-bridge" "$output")
assert_version "2.1.0" "$service_version"
assert_version "2.1.0" "$bridge_version"

# Both updated packages must carry individual tags
assert_update_has_tag "@test/platform-service" "$(get_update_tag "@test/platform-service" "$output")" "$output"
assert_update_has_tag "@test/platform-bridge" "$(get_update_tag "@test/platform-bridge" "$output")" "$output"

echo "PASS: Both platform packages bump from 2.x baseline, runtime-service is unaffected"

echo ""
echo "=== All independent versions tests passed ==="
