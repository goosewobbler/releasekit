# ReleaseKit Automation Roadmap

Future features to enable fully automated release workflows (e.g. commits to main trigger releases).

## Completed

### Unified `releasekit release` CLI
- `@releasekit/release` package at `packages/release/`
- Orchestrates `version → notes → publish` programmatically in a single command
- Skippable steps: `--skip-notes`, `--skip-publish`, `--skip-git`, `--skip-github-release`
- Early exit with code 0 when no releasable changes (CI-friendly)
- Binary: `releasekit` / `releasekit release`

### Config-Driven CI Automation (Feature 5)
- `ci` section added to `releasekit.config.json` schema (`@releasekit/config`)
- `releaseStrategy`: `direct` (default) | `manual` | `standing-pr` | `scheduled`
- `prPreview`: enable/disable PR preview comments (default: `true`)
- `autoRelease`, `skipPatterns`, `minChanges` fields for future use
- `loadCIConfig()` loader function exported from `@releasekit/config`

### Release Preview on PRs (Feature 3)
- `releasekit preview` CLI command in `@releasekit/release`
- Runs `releasekit release --dry-run` and formats a markdown PR comment
- Strategy-aware messaging: intro and no-changes messages adapt to configured `releaseStrategy`
- Auto-detects prerelease versions from package.json files; defaults to prerelease preview
- `--prerelease [identifier]` and `--stable` CLI flags for manual override
- PR label `release:stable` support in workflow templates for graduation from prerelease
- Posts/updates a single PR comment via `@octokit/rest` using HTML marker (`<!-- releasekit-preview -->`)
- Falls back to stdout when GitHub context unavailable
- `--dry-run` flag prints comment markdown to stdout without posting
- Template workflow: `templates/workflows/release-preview.yml`
- Self-hosted workflow: `.github/workflows/release-preview.yml`

### Push-Triggered Release Workflow (Feature 1)
- `.github/workflows/release.yml` implements automated releases on main push
- Uses `workflow_run` trigger to run after CI passes
- Detects release labels on merged PRs (`bump:patch`, `bump:minor`, `bump:major`, `release:prerelease`, `release:stable`)
- Automatically determines bump type from label
- Calls `_release.reusable.yml` reusable workflow for actual release
- Manual trigger also available via `workflow_dispatch`
- Release commits include `[skip ci]` to prevent infinite loops

---

## Next Up: Standing Release PR (Feature 4)

### Problem

Users want human review and approval before releases happen. Push-triggered releases are too automatic — sometimes teams want to review version bumps, check release notes, or accumulate multiple commits before publishing.

### Solution

A bot-maintained standing Release PR that accumulates version bumps and changelog changes on a `release/next` branch. Teams review the PR — verifying versions, reading generated release notes — and merge it to trigger the actual publish.

### How It Works

```
Feature PR merged → main
        │
        ▼
  standing-pr update
  (calculates versions, generates notes,
   commits to release/next, opens/updates PR)
        │
        ▼
  ┌─────────────────────────────┐
  │  Standing PR: release/next  │  ← human reviews versions,
  │  → main                    │     reads release notes
  └─────────────────────────────┘
        │
        ▼  (human merges PR)
  standing-pr publish
  (reads manifest from PR comment,
   creates tags, publishes to npm,
   creates GitHub releases, cleans up branch)
```

The merge IS the approval gate. The publish command does not merge the PR — that would defeat the purpose of human review.

### Detailed Implementation Plan

---

#### 1. Overview

The feature touches three layers:

1. **Config schema** — new `ci.standingPr` sub-configuration
2. **Core logic** — a new `standing-pr.ts` module in `@releasekit/release` that orchestrates branch/PR management
3. **CI integration** — GitHub Actions workflow template, new action modes, and preview system updates

---

#### 2. Existing Foundations

The codebase already has significant groundwork:

- **Config schema**: `ci.releaseStrategy` already accepts `'standing-pr'` in `packages/config/src/schema.ts` and `releasekit.schema.json`.
- **Preview messaging**: `preview-format.ts` already has `standing-pr` case branches for intro/no-changes messages, plus a `standingPrNumber` option in `FormatOptions`.
- **Pipeline step independence**: `runVersionStep` and `runNotesStep` can be called independently with control over where changes are written. The standing PR workflow calls these directly to materialize changes on the release branch rather than main.
- **Notes pipeline**: `runNotesStep` produces changelog files and returns their paths, which the standing PR module can commit to the release branch.
- **Publish pipeline**: `runPublishStep` already supports `skipGitCommit` in publish `types.ts`, allowing the standing PR merge workflow to handle its own git operations.
- **Action modes**: `run-action.mjs` dispatches on `mode` (`release` or `preview`). Adding new modes is straightforward.
- **Preview tests**: Tests for standing-pr messaging already exist in `preview-format.spec.ts`.

---

#### 3. Config Schema Changes

Add a new optional `ci.standingPr` object in both the Zod schema and the JSON Schema.

**Zod schema** (in `packages/config/src/schema.ts`, inside `CIConfigSchema`):

```typescript
standingPr: z.object({
  /** Branch name for the release PR. Default: 'release/next' */
  branch: z.string().default('release/next'),
  /** Title template for the release PR.
   *  Variables: ${count} (package count), ${version} (version, useful for single-package repos).
   *  Must start with 'chore: release' to match the default skip pattern on squash merge. */
  title: z.string().default('chore: release ${count} package(s)'),
  /** Labels to apply to the standing release PR */
  labels: z.array(z.string()).default(['release']),
  /** Whether to auto-delete the release branch after PR merge. Default: true */
  deleteBranchOnMerge: z.boolean().default(true),
  /** Merge method for the release PR. Affects skip-pattern compatibility:
   *  - 'squash': PR title becomes commit message — matches skip patterns automatically (recommended)
   *  - 'merge': Creates a merge commit — message format is 'Merge pull request #N from ...', must
   *    add 'Merge pull request' to skipPatterns or the merge will re-trigger update
   *  - 'rebase': Replays commits — the '[skip ci]' in the preparation commit handles loop prevention
   *  Default: 'squash' */
  mergeMethod: z.enum(['squash', 'merge', 'rebase']).default('squash'),
}).optional(),
```

**Files to modify:**
- `packages/config/src/schema.ts`
- `packages/config/src/index.ts` — export `StandingPrConfig` type
- `releasekit.schema.json` — mirror the properties

---

#### 4. Core Logic: `standing-pr.ts`

Create `packages/release/src/standing-pr.ts`.

##### Public API

```typescript
export interface StandingPROptions {
  config?: string;
  projectDir: string;
  verbose: boolean;
  quiet: boolean;
  json: boolean;
  npmAuth?: string;
}

export interface StandingPRResult {
  action: 'created' | 'updated' | 'closed' | 'noop';
  prNumber?: number;
  prUrl?: string;
  versionOutput?: VersionOutput;
}

/** Manifest stored as a bot comment on the standing PR.
 *  This is the contract between `update` and `publish`. */
export interface StandingPRManifest {
  /** Schema version for forward compatibility. */
  schemaVersion: 1;
  /** Full version output from the dry-run analysis. */
  versionOutput: VersionOutput;
  /** Generated release notes content per package. */
  releaseNotes: Record<string, string>;
  /** Paths to generated changelog/notes files (relative to repo root). */
  notesFiles: string[];
  /** ISO timestamp of when this manifest was created. */
  createdAt: string;
  /** SHA of the base branch HEAD at time of update. */
  baseSha: string;
}

/** Workflow 1: On push to main — creates/updates the release branch and PR. */
export async function runStandingPRUpdate(options: StandingPROptions): Promise<StandingPRResult>;

/** Workflow 2: On release PR merge — runs the actual publish. */
export async function runStandingPRPublish(options: StandingPROptions): Promise<ReleaseOutput | null>;
```

##### `runStandingPRUpdate` Flow

> **Working directory note**: This command modifies the working tree (switches branches, writes files). It is designed for ephemeral CI checkouts and does not restore the original branch state on completion.

1. **Load config** from `@releasekit/config`.

2. **Skip-pattern guard**: Check HEAD commit against `release.ci.skipPatterns`. If it starts with `chore: release ` or contains `[skip ci]`, exit with `action: 'noop'`.

3. **Dry-run version analysis**: Call `runVersionStep()` with `dryRun: true` to get the `VersionOutput` without writing files. This calls the version engine directly rather than going through `runRelease()`, because the standing-pr module needs to control when and where changes are materialized (on the release branch, not on main).

4. **No-changes guard**: If version step returns no updates, close any existing standing PR and return `action: 'closed'` or `action: 'noop'`.

5. **Branch management** (via `execSync`):
   - Read `ci.standingPr.branch` (default: `release/next`)
   - Read base branch from `git.branch` config (default: `main`)
   - If exists on remote: fetch and reset to `origin/<base>`
   - If not: create from `origin/<base>`
   - Checkout the release branch

6. **Materialize changes on the release branch**:
   - Call `runVersionStep()` again (non-dry-run) to write version bumps to disk
   - Call `runNotesStep(versionOutput)` to generate changelogs and release notes
   - `git add -A` + `git commit -m "chore: release preparation [skip ci]"`

   The pipeline steps are called directly — not through `runRelease()` — because the standing-pr module owns the git workflow (branch switching, committing to a different branch). This avoids changing `runRelease`'s contract.

7. **Push**: `git push --force-with-lease origin release/next`

8. **Create or update PR** via Octokit:
   - Search for existing open PR from `release/next` → base branch
   - If found: update body; if not: create
   - Apply configured labels
   - PR body uses this template:

   ```markdown
   ## Release

   This PR was automatically generated by [releasekit](https://github.com/nicknisi/releasekit).
   Merging this PR will publish the following packages:

   | Package | Version |
   |---------|---------|
   | `@scope/core` | 1.2.3 |
   | `@scope/cli` | 2.0.0 |

   ### Release Notes

   #### @scope/core — 1.2.3
   - **added**: New feature description
   - **fixed**: Bug fix description

   #### @scope/cli — 2.0.0
   - **breaking**: API change description

   ---
   > Merge this PR to publish. The release will be triggered automatically.
   ```

9. **Store manifest** as a bot comment on the PR (separate from the editable PR body):
   ```html
   <!-- releasekit-manifest -->
   <details><summary>Release manifest (do not edit)</summary>

   <!-- json {"schemaVersion":1,"versionOutput":{...},"releaseNotes":{...},"notesFiles":[...],"createdAt":"...","baseSha":"..."} -->

   </details>
   ```
   Using a comment rather than the PR body prevents accidental corruption if someone edits the PR description. Updated on each push by finding the existing bot comment via the `<!-- releasekit-manifest -->` marker.

##### `runStandingPRPublish` Flow

1. **Guard**: Verify merged PR's head ref matches `ci.standingPr.branch`. Read from `GITHUB_EVENT_PATH` → `event.pull_request.head.ref`.

2. **Read manifest**: Find the bot comment with `<!-- releasekit-manifest -->` on the merged PR via the GitHub API. Extract the JSON payload and validate `schemaVersion`.

   **Error paths**:
   - Manifest comment missing (deleted by user) → fail with: `"Release manifest not found on PR #N. Re-run 'standing-pr update' to regenerate."`
   - Manifest JSON malformed or wrong `schemaVersion` → fail with: `"Release manifest on PR #N is invalid or incompatible. Re-run 'standing-pr update'."`
   - Manifest references packages that no longer exist in the repo → warn per missing package but continue publishing the rest. A package removed between update and merge is not an error — it just has nothing to publish.
   - Manifest `baseSha` doesn't match the merge base → warn that the manifest may be stale, but proceed (the merge already happened — the human approved it).

3. **Load config**: Re-load `releasekit.config.json` from the repo (now on the merged main). Registry URLs, npm auth, cargo config, and publish options come from the current config — not from the manifest. The manifest provides the _what_ (which packages, which versions); config provides the _how_ (registry, auth, publish flags).

4. **Publish**: Call `runPublishStep(versionOutput, options, releaseNotes)` with `skipGitCommit: true`. The publish step:
   - Creates git tags for each package
   - Publishes to npm/cargo
   - Pushes tags to remote
   - Creates GitHub releases with the generated release notes

5. **Idempotency**: If publish partially fails (e.g. npm publish succeeded but tag creation failed), re-running `standing-pr publish` should skip already-published packages and already-created tags. This allows safe retries.

6. **Cleanup**: Delete release branch if `deleteBranchOnMerge` is true: `git push origin --delete release/next`. If the branch no longer exists (already deleted by GitHub's auto-cleanup or manually), treat this as a no-op (don't fail).

##### Why a PR Comment for the Manifest

The manifest must survive from `update` to `publish` — potentially days apart. Options considered:

| Approach | Pros | Cons |
|----------|------|------|
| **PR body** (hidden HTML) | No extra API calls | Users can accidentally corrupt it while editing the PR description |
| **PR comment** (bot comment) | Separate from user-editable content; easy to find via marker | Extra API call to read/write |
| **File on branch** | Simple file I/O | Lands on main after merge; needs cleanup |
| **Action artifact** | Native to CI | Ephemeral; doesn't persist across workflow runs |

PR comment wins: it's durable, isolated from user edits, and follows the same marker pattern the preview system already uses.

---

#### 5. CLI Integration

Create `packages/release/src/standing-pr-command.ts` with two subcommands:
- `releasekit standing-pr update` — creates/updates the release PR
- `releasekit standing-pr publish` — publishes from a merged release PR

Register in `dispatcher.ts` and export from `index.ts`.

---

#### 6. GitHub Action Integration

Add `standing-pr-update` and `standing-pr-publish` modes to `action.yml` and `scripts/run-action.mjs`.

New outputs:
- `standing-pr-action` — `created`, `updated`, `closed`, or `noop`
- `standing-pr-number` — the PR number
- `standing-pr-url` — the PR URL

---

#### 7. Workflow Template

Create `templates/workflows/standing-pr.yml`:

```yaml
name: Standing Release PR

on:
  push:
    branches: [main]  # Should match git.branch in config
  pull_request:
    types: [closed]
    branches: [main]

concurrency:
  group: standing-release-pr
  cancel-in-progress: false

permissions:
  contents: write
  pull-requests: write
  id-token: write

jobs:
  update-release-pr:
    name: Update Release PR
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v6
        with:
          node-version: '20'
      - run: npm ci
      - name: Configure git
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
      - name: Update standing release PR
        run: npx releasekit standing-pr update
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  publish-release:
    name: Publish Release
    if: >
      github.event_name == 'pull_request' &&
      github.event.pull_request.merged == true &&
      startsWith(github.event.pull_request.head.ref, 'release/')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v6
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - name: Configure git
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
      - name: Publish from release PR
        run: npx releasekit standing-pr publish
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

**Merge strategy note**: The default `mergeMethod` is `squash`, where the PR title becomes the commit message — matching the default skip pattern (`chore: release`) automatically. The `standing-pr merge` subcommand (follow-up) will read `mergeMethod` from config and pass it to the GitHub merge API. For repos using `merge` method, the merge commit message format is `Merge pull request #N from ...` which does NOT match the skip pattern — those repos should add `Merge pull request` to their `skipPatterns` config. The `rebase` method relies on the `[skip ci]` in the preparation commit for loop prevention.

---

#### 8. Preview System Enhancement

When `releaseStrategy` is `standing-pr`, the preview comment on feature PRs should reference the standing PR.

Add `findStandingPR` helper to `preview-github.ts`:

```typescript
export async function findStandingPR(
  octokit: Octokit,
  owner: string,
  repo: string,
  ciConfig: CIConfig | undefined,
): Promise<{ number: number; url: string } | null> {
  const branch = ciConfig?.standingPr?.branch ?? 'release/next';
  const { data: prs } = await octokit.rest.pulls.list({
    owner, repo,
    head: `${owner}:${branch}`,
    state: 'open',
    per_page: 1,
  });
  return prs[0] ? { number: prs[0].number, url: prs[0].html_url } : null;
}
```

Wire into `preview.ts` to populate `standingPrNumber` in `FormatOptions`.

---

#### 9. Edge Cases and Loop Prevention

##### Infinite Loop Prevention — Five Defense Layers

1. **`[skip ci]`**: Release preparation commit on `release/next` uses `[skip ci]`
2. **Skip patterns**: Merge commit starts with `chore: release` matching default `release.ci.skipPatterns`
3. **Branch guard**: `runStandingPRUpdate` checks `GITHUB_REF` and exits if on the release branch
4. **Head ref guard**: `runStandingPRPublish` only runs if merged PR head ref matches the release branch
5. **Workflow conditions**: `if: startsWith(github.event.pull_request.head.ref, 'release/')` in the template

##### Merge Strategy and Skip Patterns

The merge commit message must match `release.ci.skipPatterns` (default: `chore: release `) to prevent the merge from re-triggering `standing-pr update`. This works automatically with squash merge when the PR title starts with `chore: release`. For regular merge commits, GitHub uses the format `Merge pull request #N from owner/release/next` which does NOT match — so repos using regular merge should either:
- Add `Merge pull request` to `skipPatterns`, or
- Use squash merge for the release PR

The recommended default is squash merge with the PR title as the commit message.

##### Concurrent Runs

The workflow template uses `concurrency: { group: standing-release-pr, cancel-in-progress: false }`, which queues concurrent runs rather than cancelling them. If two pushes arrive in quick succession, the second run waits for the first to complete, then runs against the latest main. This is safe — the second run will recompute versions from scratch (the release branch is force-reset to the base each time).

##### No Releasable Changes

- Existing standing PR → close it with a comment explaining why
- No standing PR → `action: 'noop'`
- Orphaned release branch (no open PR) → delete it

##### Publish Failure and Retries

If publish fails partway through (e.g. npm publish succeeded but GitHub release creation failed), the release branch is NOT cleaned up. Re-running `standing-pr publish` should be safe:
- npm publish: skip packages already at the target version on the registry
- Git tags: skip tags that already exist
- GitHub releases: skip releases that already exist for the tag

This idempotency must be verified in the existing publish pipeline during implementation. If any publish sub-step is not idempotent, it needs to be made so before this feature ships.

##### Base Branch Configurability

The workflow template uses `main` as the base branch. Repos using a different default branch should update the workflow `branches` filter and ensure `git.branch` is set in `releasekit.config.json`. The `standing-pr update` command reads `git.branch` from config to determine the base.

---

#### 10. Testing Strategy

##### Unit Tests

**`packages/release/test/unit/standing-pr.spec.ts`:**
- Creates a PR when none exists
- Updates an existing PR (finds existing, updates body, updates manifest comment)
- Closes the PR when no releasable changes
- Exits early on skip-pattern match
- Exits early when HEAD is on the release branch
- Reads manifest from PR comment and publishes
- Exits early when merged PR is not the release branch
- Cleans up the release branch after publish
- Handles publish retry (idempotency)
- Manifest comment missing → fails with actionable error message
- Manifest JSON malformed → fails with actionable error message
- Manifest references removed package → warns and publishes remaining
- PR body renders correctly for single-package repos (uses `${version}`)
- PR body renders correctly for monorepos (uses `${count}`)

**`packages/release/test/unit/standing-pr-command.spec.ts`:**
- CLI argument parsing (following `release-command.spec.ts` pattern)

**Existing test updates:**
- `preview.spec.ts` — standing PR number discovery
- `preview-github.spec.ts` — `findStandingPR` helper
- `packages/config/test/unit/schema.spec.ts` — validate `ci.standingPr` including `mergeMethod`

##### Integration Tests

The standing PR feature has significant integration surface (GitHub API, git branch operations, multi-step workflows). Unit tests with mocked APIs are necessary but insufficient.

**`packages/release/test/integration/standing-pr.integration.spec.ts`:**
- End-to-end update flow against a fixture git repo (local, no GitHub): init repo → create commits → run update → verify branch exists, version files written, commit message correct
- End-to-end publish flow: verify tags created, branch deleted
- Round-trip: update → verify manifest written → read manifest back → verify it matches original version output
- Publish idempotency: run publish twice → second run succeeds with no-op for already-published items

GitHub API interactions (PR creation, comment read/write) remain mocked in integration tests — testing against real GitHub is out of scope.

---

#### 11. Documentation Updates

- `packages/release/README.md` — update strategy table, add usage section
- `packages/release/docs/ci-setup.md` — add "Standing Release PR" section with workflow template, merge strategy guidance
- `docs/action.md` — add new action modes
- `docs/getting-started.md` — mention standing PR workflow as an alternative

---

#### 12. Implementation Sequence

| Phase | Steps |
|-------|-------|
| **1. Config & Types** | `StandingPrConfigSchema` in config schema (incl. `mergeMethod`) → export `StandingPrConfig` and `StandingPRManifest` types → update JSON Schema → config tests |
| **2. Pipeline decomposition** | Ensure `runVersionStep` and `runNotesStep` are callable independently from `standing-pr.ts` without going through `runRelease`. Verify they accept the same config/options and return the needed outputs (`VersionOutput`, notes file paths). Refactor if necessary — but prefer thin wrappers over changing `runRelease`'s internals. Verify publish idempotency (skip existing tags, packages, releases). |
| **3. Core Logic** | `standing-pr.ts` (`runStandingPRUpdate`, `runStandingPRPublish`) → `findStandingPR` helper → manifest read/write helpers → CLI command → register in dispatcher → export → unit tests → integration tests |
| **4. Preview Integration** | Wire standing PR number into preview → preview tests |
| **5. Action & Workflow** | New action modes → arg builders → workflow template |
| **6. Documentation** | README, ci-setup.md, action.md, getting-started.md |

---

#### 13. Key Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| **Manifest in PR comment** (bot comment, not body) | Isolated from user edits; durable across workflow runs; follows existing marker pattern |
| **Manifest has `schemaVersion`** | Forward compatibility — allows future manifest format changes without breaking older `publish` runs |
| **Merge is the approval gate** | The publish command does not merge — merging is the human approval action |
| **Force-push the release branch** | Resets to base branch each time for simple conflict handling; same approach as changesets. Manual commits on the release branch will be lost — this is intentional |
| **Separate CLI subcommands** | `standing-pr update` and `standing-pr publish` keep the `release` command clean and make workflow steps explicit |
| **Call pipeline steps directly** (not through `runRelease`) | `standing-pr.ts` calls `runVersionStep` and `runNotesStep` directly because it needs to control _where_ changes are materialized (on the release branch, not main). Going through `runRelease` would require adding a "prepare but don't commit" mode to its contract |
| **Config from repo, versions from manifest** | `publish` re-loads `releasekit.config.json` for registry/auth/publish settings (the _how_) but reads package versions from the manifest (the _what_). This keeps publish behaviour consistent with current config even if config changed between update and merge |
| **Publish idempotency** | Safe retries after partial failures — skip already-published packages and tags. Must be verified during implementation |
| **Squash merge default, configurable** | `mergeMethod` in config (default `squash`) ensures merge commit message matches skip patterns for loop prevention. Included in initial implementation because the skip-pattern interaction is load-bearing |
| **Ephemeral working directory** | `standing-pr update` modifies the checkout (switches branches, writes files) and does not restore it. Designed for CI where the checkout is disposable |

---

### Follow-Up Tasks

These are enhancements to build after the core standing PR feature ships:

#### `standing-pr merge` subcommand

A CLI command that merges the standing PR via the GitHub API and optionally publishes in one step. Useful for CLI-driven workflows where someone wants to trigger a release programmatically after reviewing the PR in the browser.

```bash
# Merge the standing PR and publish
releasekit standing-pr merge --publish

# Merge only (let the workflow handle publish)
releasekit standing-pr merge
```

The merge should honour branch protection rules (required reviews, status checks) by using the GitHub merge API rather than git. If protections block the merge, the command should fail with a clear message.

#### Release notes editing in PR

The standing PR body shows generated release notes as read-only content. A follow-up could allow users to edit a designated section of the PR body (e.g. between `<!-- releasekit-editable -->` markers) and have those edits used as the GitHub Release body instead of the auto-generated notes. This gives teams a way to add context or highlight specific changes without affecting the generated changelogs.

#### Standing PR status checks

Add a mechanism for the standing PR to report its own status — e.g. a check run that shows whether the PR is up-to-date with main, or whether the manifest is stale. This helps reviewers know when it's safe to merge.

#### Batch release accumulation controls

Config options to control when the standing PR is "ready" for merge:
- `ci.standingPr.minAge` — minimum time since last update before the PR is considered ready (prevents merging immediately after every push)
- `ci.standingPr.minPackages` — minimum number of packages with changes before the PR is created
- These could be enforced via a GitHub status check that blocks merge until conditions are met

---

## Planned Features

### Scheduled Releases

> **TODO:** Config schema supports `releaseStrategy: 'scheduled'` and preview messaging is in place.
> What remains: the actual cron-triggered workflow logic and any CLI support for scheduled release batching.

**Goal:** Releases are triggered on a schedule (e.g. weekly) rather than on every push or PR merge.

**What to build:**
- Workflow template with `schedule` (cron) trigger
- Collects all unreleased changes since last tag
- Runs `releasekit release` if there are releasable changes
- Preview comments on PRs indicate changes will be included in the "next scheduled release"

**Considerations:**
- Need to decide if scheduled releases can be combined with other strategies
- Should support configurable cron expression
- May need a "release window" concept where PRs merged during the window are batched

---

## Implementation Priority

| Feature | Effort | Impact | Status |
|---------|--------|--------|--------|
| Config-driven automation (5) | Low | Medium | Done |
| Release preview on PRs (3) | Medium | Medium | Done |
| Push-triggered workflow (1) | Low | High | Done |
| GitHub Action (1) | Medium | High | Done |
| Standing release PR (4) | High | Medium | **Next** |
| Scheduled releases | Medium | Medium | Planned |
