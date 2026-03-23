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
- `releaseStrategy`: `manual` (default) | `direct` | `standing-pr` | `scheduled`
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

---

## Planned Features

### 1. Push-Triggered Release Workflow

**Goal:** Commits to `main` automatically trigger a release when there are releasable changes.

**What exists today:**
- `release.yml` is `workflow_dispatch` only (manual trigger)
- CI workflow already runs on push to main but only runs tests
- The reusable workflows (`_release-prepare`, `_release-publish`, `_release-post`) are already modular

**What to build:**
- New workflow file: `.github/workflows/release-on-push.yml`
- Trigger: `push` to `main` (with path filters to ignore release commits)
- Calls `releasekit release` (the new unified CLI) or reuses existing reusable workflows
- Must filter out release commits to prevent infinite loops — use `[skip ci]` in commit messages (already in version templates) AND/OR check commit author (bot)
- Should run after CI passes (use `workflow_run` trigger on CI completion, or call CI as a reusable workflow first)

**Example workflow structure:**
```yaml
on:
  push:
    branches: [main]

jobs:
  ci:
    # Run tests first
    uses: ./.github/workflows/ci.yml

  release:
    needs: ci
    if: "!contains(github.event.head_commit.message, '[skip ci]')"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: ./.github/workflows/actions/setup-workspace
      - run: pnpm build
      - run: releasekit release --json
```

**Considerations:**
- `fetch-depth: 0` is required for commit analysis
- GITHUB_TOKEN permissions: `contents: write`, `id-token: write` (for npm provenance)
- Deploy key or PAT for pushing commits/tags (GITHUB_TOKEN can't trigger further workflows)

---

### 2. GitHub Action (`releasekit/action`)

**Goal:** Provide a reusable GitHub Action so other repos can use releasekit with minimal config.

**What to build:**
- `action.yml` at repo root (or in a separate `releasekit/action` repo)
- Composite action that installs releasekit and runs `releasekit release`
- Inputs map to CLI flags: `bump`, `dry-run`, `skip-notes`, `skip-publish`, etc.
- Outputs: `version`, `tags`, `has-changes`, `release-url`

**Example usage by consumers:**
```yaml
- uses: goosewobbler/releasekit@v1
  with:
    dry-run: false
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

**Implementation options:**
- **Composite action** (simpler) — installs Node, pnpm, releasekit, runs CLI
- **JavaScript action** (more control) — bundles releasekit, no install step needed
- Composite is recommended initially; can migrate to JS action later for performance

**Considerations:**
- Need to publish `@releasekit/release` to npm first (or bundle in the action)
- Handle authentication: npm token, GitHub token, cargo token
- Support OIDC for npm provenance in the action context

---

### 3. Release Preview on PRs ✓

> **Completed** — see "Completed" section above.

---

### 4. Standing Release PR (Changesets-Style)

> **TODO:** Config schema supports `releaseStrategy: 'standing-pr'` and preview messaging is in place.
> What remains: the actual standing PR workflow logic (branch management, PR creation/update, merge-triggered publish).

**Goal:** A bot maintains a standing "Release" PR that accumulates changes and shows the next release. Merging the PR triggers the actual publish.

**What to build:**
- Workflow on push to `main` that:
  1. Runs `releasekit release --dry-run --skip-publish --json`
  2. Creates/updates a branch (`release/next`) with version bumps and changelog
  3. Opens/updates a PR from `release/next` → `main`
- Separate workflow on PR merge that detects the release branch and runs the actual publish
- Preview comment should reference the standing PR number when one exists

**How it differs from push-triggered releases:**
- Human reviews and approves each release by merging the PR
- Changelog is visible and editable before release
- Multiple commits can accumulate before releasing

**Considerations:**
- More complex than push-triggered — requires branch management
- PR description should show full changelog diff
- Need to handle conflicts if main moves ahead
- This is a larger feature — implement after the simpler automation patterns

---

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

### 5. Config-Driven Automation Mode ✓

> **Completed** — see "Completed" section above.
>
> **TODO:** `skipPatterns`, `minChanges`, and `autoRelease` fields are defined in the schema but not yet consumed by any workflow or CLI logic. Wire these up when implementing push-triggered releases (feature 1) and scheduled releases.

---

## Implementation Priority

| Feature | Effort | Impact | Status |
|---------|--------|--------|--------|
| Config-driven automation (5) | Low | Medium | ✓ Done |
| Release preview on PRs (3) | Medium | Medium | ✓ Done |
| Push-triggered workflow (1) | Low | High | Next |
| GitHub Action (2) | Medium | High | Planned |
| Standing release PR (4) | High | Medium | Planned (schema ready) |
| Scheduled releases | Medium | Medium | Planned (schema ready) |

**Next up:** Push-triggered release workflow (feature 1). The CI config schema (`releaseStrategy: 'direct'`, `skipPatterns`, `autoRelease`) is already in place to support it.
