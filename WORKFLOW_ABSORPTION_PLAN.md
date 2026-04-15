# Releasekit CI Workflow Absorption Plan

## Context

Both the wdio-desktop-mobile repo and the releasekit repo itself have significant CI workflow boilerplate around release orchestration — label checking, scope-to-package resolution, conditional checkout, build commands, and summary generation. This logic is generic and belongs inside releasekit's GitHub Action and CLI.

**Goal:** Implement 4 features in releasekit that eliminate release-orchestration boilerplate from consumer workflow YAML.

## Implementation Order

Dependencies: Feature 2 (scope flag) is foundational for Feature 1 (gate mode). Feature 3 (summary) depends on Feature 1 for `buildGateSummary`. Feature 4 is fully independent.

**Order: 4 → 2 → 1 → 3**

Rationale: Feature 4 has the highest value/effort ratio (~5k tokens, no TypeScript) and ships independently — do it first and release it while building the larger features. Feature 2 is a prerequisite for Gate so comes next. Feature 1 is the primary deliverable. Feature 3 is additive polish that can't fully ship until Gate exists.

---

## Feature 2: Scope Resolution Flag (`--scope`)

**Complexity:** 2.5/10 | **Estimated tokens:** ~20k

**Eliminates:** `resolve-manual` job in wdio `release.yml` (lines 117-145)

Add `--scope <name>` to the `release` command. Given `--scope electron`, look up `scope:electron` (then `electron`) in `ci.scopeLabels` config and use the matched pattern as `--target`.

### Files to modify

**`packages/release/src/types.ts`** — add `scope?: string` to `ReleaseOptions`

**`packages/release/src/release.ts`** — add and export `resolveScopeToTarget()`:
```typescript
export function resolveScopeToTarget(scopeName: string, scopeLabels: Record<string, string>): string {
  // Try prefixed first (scope:electron), then bare (electron)
  const prefixed = `scope:${scopeName}`;
  if (scopeLabels[prefixed]) return scopeLabels[prefixed];
  if (scopeLabels[scopeName]) return scopeLabels[scopeName];
  const available = Object.keys(scopeLabels).join(', ');
  throw new Error(`Scope "${scopeName}" not found in ci.scopeLabels. Available: ${available}`);
}
```
At top of `runRelease()`, after loading config, if `options.scope` is set: resolve it, set `effectiveTarget`, log the resolution. This runs BEFORE `applyScopeLabelsFromPR` (which is a no-op for manual triggers anyway).

**`packages/release/src/release-command.ts`** — add `.option('--scope <name>', 'Resolve scope name to target packages from ci.scopeLabels config')` after `--target`. Pass `scope: opts.scope` into options.

**`action.yml`** — add `scope` input, add `INPUT_SCOPE` to env block

**`scripts/run-action.mjs`** — add `scope` to `parseInputs()`, add `pushOptionalArg(args, '--scope', input.scope)` to `buildReleaseArgs()`

### Tests
- `packages/release/test/unit/release.spec.ts` — test `resolveScopeToTarget()` (prefixed, bare, not found, precedence)
- `test/integration/action-runner.spec.ts` — test `--scope` in `buildReleaseArgs`

---

## Feature 1: Gate Mode (`releasekit gate`)

**Complexity:** 6/10 | **Estimated tokens:** ~75k

**Eliminates:** `check-release` job in wdio `release.yml` (lines 51-94) and `check-labels` job in releasekit's own `release.yml` (lines 61-141)

A lightweight command that checks PR labels and outputs whether a release should proceed, what bump type, and resolved scope/target.

### Output type
```typescript
interface GateOutput {
  shouldRelease: boolean;
  bump?: string;        // 'major' | 'minor' | 'patch' | 'auto' | 'prepatch' | etc.
  scope?: string;       // resolved scope name
  target?: string;      // resolved package pattern
  labels: string[];     // all labels found
  prNumbers: number[];  // merged PR numbers
  blocked?: boolean;    // label conflicts
  reason?: string;      // human-readable decision reason
}
```

### Files to create

**`packages/release/src/gate.ts`** — core `runGate(options: GateOptions): Promise<GateOutput>`

Logic (reuses existing functions):
1. `loadReleaseKitConfig()` → get `ciConfig`
2. **Strategy guard**: If `releaseStrategy` is `standing-pr` or `scheduled`, fail with a clear error:
   - `standing-pr`: `"Gate mode is not compatible with releaseStrategy: 'standing-pr'. Use 'releasekit standing-pr update' instead — see docs/ci-setup.md."`
   - `scheduled`: `"Gate mode is not compatible with releaseStrategy: 'scheduled'. Scheduled releases are triggered by cron, not by gate checks."`
   Gate is designed for `direct` and `manual` workflows only — strategies where a CI job needs to decide whether to proceed with `releasekit release`.
3. `getGitHubContext()` → owner, repo, sha (extract from `release.ts` to `preview-github.ts`)
   - If no GitHub context available (running locally or missing env vars), return `{ shouldRelease: false, labels: [], prNumbers: [], reason: 'No GitHub context available (missing GITHUB_REPOSITORY or GITHUB_SHA)' }`.
4. `createOctokit()` + `findMergedPRsForCommit()` + `fetchPRLabels()` — all from `preview-github.ts`
   - If no `GITHUB_TOKEN`, return `{ shouldRelease: false, labels: [], prNumbers: [], reason: 'No GITHUB_TOKEN available' }`.
5. `detectLabelConflicts()` — from `label-utils.ts`
6. Determine `shouldRelease` based on `releaseTrigger` mode:
   - `label` mode: true only if `bump:*` or `release:stable` label present
   - `commit` mode: true unless `release:skip` present
7. Determine `bump` from labels (same logic as releasekit's own `check-labels` shell script lines 98-137)
8. Resolve scope via `resolveScopeToTarget()` (from Feature 2) or from PR scope labels
9. Check `skipPatterns` against HEAD commit message
10. Return `GateOutput`

**`packages/release/src/gate-command.ts`** — CLI command with options: `--config`, `--scope`, `--json`, `--verbose`, `--quiet`, `--project-dir`

### Files to modify

**`packages/release/src/preview-github.ts`** — add exported `getGitHubContext()` (moved from `release.ts`)

**`packages/release/src/release.ts`** — import `getGitHubContext` from `preview-github.ts` instead of local function

**`packages/release/src/dispatcher.ts`** — `program.addCommand(createGateCommand())`

**`packages/release/src/cli.ts`** — `.addCommand(createGateCommand())`

**`packages/release/src/index.ts`** — export `runGate`, `GateOptions`, `GateOutput`

**`action.yml`**:
- Update `mode` description to include `gate`
- Add outputs: `should-release`, `bump`, `gate-scope`, `gate-target`

**`scripts/run-action.mjs`**:
- Add `buildGateArgs(input)` — always includes `--json`
- Add `writeGateOutputs(stdout)` — parses JSON, sets outputs
- Update mode validation in `runAction()` to accept `'gate'`
- Update `main()` to dispatch to gate handlers

### Tests

**`packages/release/test/unit/gate.spec.ts`** — mock GitHub API functions:
- `shouldRelease: true` when `bump:minor` label present (label trigger mode)
- `shouldRelease: true` when no release labels present (commit trigger mode)
- `shouldRelease: false` when no bump/release labels present (label trigger mode)
- `shouldRelease: false` when `release:skip` label present (commit trigger mode)
- `blocked: true` when `bump:major` + `bump:minor` conflict
- `blocked: true` when `release:prerelease` + `release:stable` conflict
- `bump` correctly resolved from label (`bump:major` → `major`, `bump:patch` → `patch`)
- `bump` is `undefined` when only `release:stable` label (auto-detect from commits)
- Scope resolved via `resolveScopeToTarget` when `--scope` passed
- Scope resolved from PR scope labels when no `--scope` flag
- `shouldRelease: false` when HEAD commit matches `skipPatterns`
- Fails with clear error when `releaseStrategy: 'standing-pr'`
- Fails with clear error when `releaseStrategy: 'scheduled'`
- Returns `shouldRelease: false` with reason when no GitHub context
- Returns `shouldRelease: false` with reason when no `GITHUB_TOKEN`
- `prNumbers` populated from merged PRs
- Labels aggregated across multiple merged PRs

**`test/integration/action-runner.spec.ts`** — test `buildGateArgs`

---

## Feature 4: SSH Key / Conditional Checkout

**Complexity:** 1.5/10 | **Estimated tokens:** ~5k

**Eliminates:** dual checkout pattern in wdio `_release.reusable.yml` (lines 54-67)

### Files to modify

**`action.yml`** only — replace single checkout step with:
```yaml
- name: Checkout (SSH)
  if: ${{ secrets.ssh_key != '' && inputs.dry-run != 'true' && inputs.mode != 'gate' }}
  uses: actions/checkout@v6
  with:
    ssh-key: ${{ secrets.ssh_key }}
    fetch-depth: 0

- name: Checkout (read-only)
  if: ${{ secrets.ssh_key == '' || inputs.dry-run == 'true' || inputs.mode == 'gate' }}
  uses: actions/checkout@v6
  with:
    fetch-depth: 0
```

Add secret:
```yaml
secrets:
  ssh_key:
    description: SSH deploy key for git push (enables SSH checkout when not dry-run)
    required: false
```

No TypeScript changes needed.

---

## Feature 3: Auto-Generate GITHUB_STEP_SUMMARY

**Complexity:** 3.5/10 | **Estimated tokens:** ~30k

**Eliminates:** summary shell block in wdio `_release.reusable.yml` (lines 149-209)

### Files to modify

**`action.yml`** — add `summary` input (default: `"true"`)

**`scripts/run-action.mjs`**:
- Add `summary` to `parseInputs()`
- Add `writeSummary(markdown)` — appends to `GITHUB_STEP_SUMMARY` file
- Add `buildReleaseSummary(input, parsed, success)` — generates markdown with:
  - Settings table (scope, bump, packages, dry-run)
  - Failure/no-changes/dry-run banners
  - Package updates table (from `versionOutput.updates`)
  - Tags list (from `versionOutput.tags`)
- Add `buildGateSummary(input, parsed)` — generates markdown with:
  - Check results table (should-release, bump, scope, target, labels, PRs)
  - Blocked/reason messages
- Restructure `main()` so summary is written BEFORE `setFailure()` (which calls `process.exit(1)`)

### Tests
- `test/integration/action-runner.spec.ts` — test `buildReleaseSummary()` and `buildGateSummary()` with various inputs

## Summary of All Changes

### New files (3)
| File | Purpose |
|------|---------|
| `packages/release/src/gate.ts` | Gate mode core logic |
| `packages/release/src/gate-command.ts` | Gate CLI command |
| `packages/release/test/unit/gate.spec.ts` | Gate unit tests |

### Modified files (8)
| File | Changes |
|------|---------|
| `packages/release/src/types.ts` | Add `scope` to `ReleaseOptions` |
| `packages/release/src/release.ts` | Add `resolveScopeToTarget()`, use scope, extract `getGitHubContext` |
| `packages/release/src/release-command.ts` | Add `--scope` option |
| `packages/release/src/preview-github.ts` | Receive `getGitHubContext()` export |
| `packages/release/src/dispatcher.ts` | Register gate command |
| `packages/release/src/cli.ts` | Register gate command |
| `packages/release/src/index.ts` | Export gate types |
| `action.yml` | Gate mode, ssh_key secret, scope, summary inputs; conditional checkout |
| `scripts/run-action.mjs` | Gate args/outputs, scope parsing, summary generation, restructured main() |

### Modified test files (2)
| File | Changes |
|------|---------|
| `packages/release/test/unit/release.spec.ts` | Scope resolution tests |
| `test/integration/action-runner.spec.ts` | Gate args, summary builder tests |

## Verification

After implementation, verify by:
1. **Unit tests:** `pnpm test` in releasekit repo
2. **Build:** `pnpm build` to ensure TypeScript compiles
3. **Lint:** `pnpm lint`
4. **Manual CLI test:** `node packages/release/dist/cli.js gate --help` shows the new command
5. **Dry run in wdio repo:** Update wdio's workflows to use local releasekit action, run `workflow_dispatch` with `dry_run: true`
6. **Eat own dogfood:** Update releasekit's own `release.yml` to use `mode: gate` instead of the `check-labels` shell script

## Consumer Workflow (After)

wdio's `release.yml` would simplify to:
```yaml
jobs:
  gate:
    if: github.event_name == 'workflow_run' && ...
    uses: goosewobbler/releasekit@v0.11
    with:
      mode: gate

  release:
    needs: gate
    if: needs.gate.outputs.should-release == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          ssh-key: ${{ secrets.DEPLOY_KEY }}
          fetch-depth: 0
      - run: pnpm turbo run build --filter='${{ needs.gate.outputs.gate-target }}...'
      - uses: goosewobbler/releasekit@v0.11
        with:
          mode: release
          scope: ${{ needs.gate.outputs.gate-scope }}
          bump: ${{ needs.gate.outputs.bump }}
          json: 'true'
        secrets:
          ssh_key: ${{ secrets.DEPLOY_KEY }}
```

The `resolve-manual` job and most of the `check-release` job are eliminated. Build commands remain in the consumer workflow as a regular step — releasekit provides the gate outputs (`gate-target`, `gate-scope`) that the build step can reference.
