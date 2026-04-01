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
- Detects release labels on merged PRs (`release:patch`, `release:minor`, `release:major`, `release:prerelease`, `release:stable`)
- Automatically determines bump type from label
- Calls `_release.reusable.yml` reusable workflow for actual release
- Manual trigger also available via `workflow_dispatch`
- Release commits include `[skip ci]` to prevent infinite loops

---

## Planned Features

### 1. GitHub Action (`releasekit/action`)

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

> **Completed** - see "Completed" section above.
>
> `skipPatterns`, `minChanges`, and `autoRelease` fields are defined in the schema and used by `.github/workflows/release.yml` for automated releases.

---

## Implementation Priority

| Feature | Effort | Impact | Status |
|---------|--------|--------|--------|
| Config-driven automation (5) | Low | Medium | ✓ Done |
| Release preview on PRs (3) | Medium | Medium | ✓ Done |
| Push-triggered workflow (1) | Low | High | ✓ Done |
| GitHub Action (1) | Medium | High | Next |
| Standing release PR (4) | High | Medium | Planned |
| Scheduled releases | Medium | Medium | Planned |

**Next up:** GitHub Action (feature 1) - a reusable action for other repos to use releasekit.
