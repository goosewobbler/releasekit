# ReleaseKit Automation Roadmap

Future features to enable fully automated release workflows (e.g. commits to main trigger releases).

## Completed

### Unified `releasekit release` CLI
- `@releasekit/release` package at `packages/release/`
- Orchestrates `version → notes → publish` programmatically in a single command
- Skippable steps: `--skip-notes`, `--skip-publish`, `--skip-git`, `--skip-github-release`
- Early exit with code 0 when no releasable changes (CI-friendly)
- Binary: `releasekit` / `releasekit release`

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

### 3. Release Preview on PRs

**Goal:** Automatically comment on PRs with a preview of what the release would look like if merged.

**What to build:**
- Workflow triggered on `pull_request` to `main`
- Runs `releasekit release --dry-run --json`
- Posts/updates a PR comment with:
  - Next version number(s)
  - Changelog preview
  - Packages that would be published
- Updates the comment on each push to the PR (find existing comment by marker)

**Example output in PR comment:**
```markdown
## Release Preview

This PR will trigger the following release when merged:

**@releasekit/version** `0.1.0` → `0.2.0` (minor)

### Changelog
- feat: add unified release command
- fix: resolve preset loading issue

---
*Updated automatically by ReleaseKit*
```

**Considerations:**
- Use `peter-evans/create-or-update-comment` or `gh api` to manage comments
- Needs `pull-requests: write` permission
- Should handle "no releasable changes" case gracefully

---

### 4. Standing Release PR (Changesets-Style)

**Goal:** A bot maintains a standing "Release" PR that accumulates changes and shows the next release. Merging the PR triggers the actual publish.

**What to build:**
- Workflow on push to `main` that:
  1. Runs `releasekit release --dry-run --skip-publish --json`
  2. Creates/updates a branch (`release/next`) with version bumps and changelog
  3. Opens/updates a PR from `release/next` → `main`
- Separate workflow on PR merge that detects the release branch and runs the actual publish

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

### 5. Config-Driven Automation Mode

**Goal:** Allow users to configure automation behavior in `releasekit.config.json`.

**What to add to the config schema:**
```jsonc
{
  "release": {
    // Which steps to run by default
    "steps": ["version", "notes", "publish"],
    // CI-specific settings
    "ci": {
      // Skip patterns — don't release for these commit prefixes
      "skipPatterns": ["chore(deps):", "ci:"],
      // Minimum changes required to trigger a release
      "minChanges": 1,
      // Whether to create GitHub releases
      "githubRelease": true,
      // Whether to generate changelogs
      "notes": true
    }
  }
}
```

**Where this fits:**
- The `releasekit release` CLI reads this config section
- The push-triggered workflow and GitHub Action respect these settings
- Allows per-repo customization without workflow changes

---

## Implementation Priority

| Feature | Effort | Impact | Priority |
|---------|--------|--------|----------|
| Push-triggered workflow | Low | High | 1 |
| Release preview on PRs | Medium | Medium | 2 |
| GitHub Action | Medium | High | 3 |
| Config-driven automation | Low | Medium | 4 |
| Standing release PR | High | Medium | 5 |

**Recommended order:** Start with the push-triggered workflow (it's mostly a new `.yml` file) and PR preview (good developer experience), then package as a GitHub Action for external adoption.
