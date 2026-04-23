# CI Setup

This guide covers common GitHub Actions patterns for automating releases with `@releasekit/release`.

## Prerequisites

All workflows require:

- `fetch-depth: 0` on checkout — ReleaseKit reads git history to determine version bumps
- A `GITHUB_TOKEN` with `contents: write` permission for tagging and GitHub Releases
- Node.js 20+

---

## Minimal Setup (push to main)

Trigger a release on every push to `main`. If there are no releasable commits, the command exits cleanly with code 0 and does nothing.

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    branches: [main]

permissions:
  contents: write
  id-token: write   # for npm OIDC trusted publishing

jobs:
  release:
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

      - run: npx releasekit release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # For OIDC trusted publishing (recommended) — no NPM_TOKEN needed.
          # For token-based publishing: NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

---

## Label-Based Trigger

Only release when a PR is merged with a release label. Conventional commits determine the changelog entries; the label controls whether and at what level to bump.

**Required labels** (customisable in config):

| Label | Effect |
|-------|--------|
| `bump:patch` | Bump patch version |
| `bump:minor` | Bump minor version |
| `bump:major` | Bump major version |
| `release:stable` | Graduate a prerelease to stable |
| `release:prerelease` | Create a prerelease (requires bump:* label) |
| `release:skip` | Suppress release on this PR |

#### Label combinations

| Labels | Current version | Result |
|--------|-----------------|--------|
| `bump:patch` | `1.0.0` | `1.0.1` |
| `bump:minor` | `1.0.0` | `1.1.0` |
| `bump:major` | `1.0.0` | `2.0.0` |
| `bump:patch` | `1.0.0-next.6` | `1.0.1` — graduates prerelease to stable patch |
| `bump:minor` | `1.0.0-next.6` | `1.1.0` — graduates prerelease to stable minor |
| `bump:major` | `1.0.0-next.6` | `2.0.0` — graduates prerelease to stable major |
| `release:prerelease` + `bump:patch` | `1.0.0` | `1.0.1-next.0` |
| `release:prerelease` + `bump:minor` | `1.0.0` | `1.1.0-next.0` |
| `release:prerelease` + `bump:major` | `1.0.0` | `2.0.0-next.0` |
| `release:prerelease` + `bump:patch` | `1.0.0-next.6` | `1.0.0-next.7` — increments prerelease counter |
| `release:prerelease` + `bump:minor` | `1.0.0-next.6` | `1.0.0-next.7` — increments prerelease counter |
| `release:prerelease` + `bump:major` | `1.0.0-next.6` | `1.0.0-next.7` — increments prerelease counter |
| `release:prerelease` alone | any | No release — add a `bump:*` label |
| `release:stable` alone | `1.0.0-next.6` | `1.0.0` |
| `release:stable` alone | `1.0.0` | No release — already at stable version |
| `release:stable` + any `bump:*` | `1.0.0-next.6` | `1.0.0` — bump label is ignored during stable promotion |
| `release:stable` + `bump:minor` | `1.0.0` | `1.1.0` — bump applies to already-stable packages |

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    branches: [main]

permissions:
  contents: write
  id-token: write
  pull-requests: read

jobs:
  release:
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

      - run: npx releasekit release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Configure the trigger in `releasekit.config.json`:

```json
{
  "ci": {
    "releaseTrigger": "label",
    "labels": {
      "major": "bump:major",
      "minor": "bump:minor",
      "patch": "bump:patch",
      "skip": "release:skip"
    }
  }
}
```

Without a `bump:patch/minor/major` label on the merged PR, no release is triggered. The `labels` block shown above reflects the defaults — omit it if your repository already uses those label names.

See [@releasekit/release — CI Configuration](../README.md#ci-configuration) for all `ci.*` options.

---

## PR Preview Comments

Post a comment on every PR showing what would be released if merged. Requires `pull-requests: write`.

```yaml
# .github/workflows/release-preview.yml
name: Release Preview

on:
  pull_request:
    branches: [main]
    types: [opened, synchronize, labeled, unlabeled]

concurrency:
  group: release-preview-${{ github.event.pull_request.number }}
  cancel-in-progress: true

permissions:
  pull-requests: write
  contents: read

jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v6
        with:
          node-version: '20'

      - run: npm ci

      - run: npx releasekit preview
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

A ready-to-use template is available at [`templates/workflows/release-preview.yml`](../../../templates/workflows/release-preview.yml).

---

## Standing Release PR

Accumulate release changes in a persistent "standing" PR that auto-updates as commits land on `main`. Maintainers review and merge the PR when ready to release.

**Benefits:**
- Changes accumulate in a single PR — easier code review for release notes and version decisions
- Merge controls timing — release when business/product goals align
- Can coexist with label-triggered direct releases (see below)

**Configuration:**

```json
{
  "ci": {
    "releaseStrategy": "standing-pr",
    "standingPr": {
      "branch": "release/next",
      "title": "chore: release ${count} package(s)",
      "labels": ["release"],
      "deleteBranchOnMerge": true,
      "mergeMethod": "squash"
    }
  }
}
```

**Workflow** (`standing-pr.yml` — separate from your existing release workflow):

```yaml
# .github/workflows/standing-pr.yml
name: Standing Release PR

on:
  push:
    branches: [main]
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
          token: ${{ github.token }}

      - uses: actions/setup-node@v6
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'

      - run: npm ci

      - name: Configure git
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"

      - run: npx releasekit standing-pr update
        env:
          GITHUB_TOKEN: ${{ github.token }}

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
          token: ${{ github.token }}

      - uses: actions/setup-node@v6
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'

      - run: npm ci

      - name: Configure git
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"

      - run: npx releasekit standing-pr publish
        env:
          GITHUB_TOKEN: ${{ github.token }}
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

**How it works:**

1. **Updates → PR:** On every push to `main`, `standing-pr update` detects version changes and force-resets `release/next` to main, then rewrites the bumps and changelogs. The PR body is kept in sync.
2. **Merge to Release:** Maintainers merge the standing PR when ready.
3. **Publish:** The `pull_request.closed` trigger fires, `standing-pr publish` reads the manifest from the merged PR's bot comment and publishes without re-running version analysis.

Use `release:stable` and `release:prerelease` labels on **the standing PR itself** to control release type during merge.

---

## Combining Standing PR with Label-Triggered Direct Releases

The two strategies can run side by side. This lets teams accumulate work in a standing PR by default, while still allowing any PR to trigger an immediate release by applying a label.

**How they coexist:**

- A PR merged **with** a `bump:*` label → `release.yml` fires and publishes immediately. The `standing-pr update` run for the same push sees the resulting release commit (which matches the default skip pattern `chore: release`) and exits as a noop. On the next real commit, `standing-pr update` computes bumps only from commits since the new tag — it starts fresh automatically.
- A PR merged **without** a label → `release.yml` finds no bump label and exits. `standing-pr update` accumulates the change into the standing PR as normal.

There is no double-publish risk: the standing PR only publishes when *its own branch* (`release/next`) is merged, which only happens when a maintainer explicitly merges it.

**Setup:**

Keep your existing `release.yml` unchanged. Add `standing-pr.yml` alongside it (shown above). In config, set `releaseStrategy: 'standing-pr'` so PR preview comments default to standing-PR messaging; label-triggered releases still work regardless of this setting.

```json
{
  "ci": {
    "releaseStrategy": "standing-pr",
    "releaseTrigger": "label",
    "standingPr": {
      "branch": "release/next",
      "mergeMethod": "squash"
    }
  }
}
```

**Decision guide:**

| Situation | Action |
|-----------|--------|
| Routine feature — batch with others | Merge PR without a label |
| Critical fix or time-sensitive feature | Add `bump:patch` (or `minor`/`major`) to the PR |
| Promote accumulated prereleases to stable | Add `release:stable` to the standing PR and merge it |

---

## npm OIDC Trusted Publishing (Recommended)

With OIDC, no `NPM_TOKEN` secret is required. The workflow exchanges a GitHub-issued OIDC token for a short-lived npm token at publish time.

**Requirements:**
- npm `>=9.5.0`
- Each package must have an **Automation policy** configured at npmjs.com (Settings → Automation policies → add a GitHub Actions OIDC publisher for your repo and workflow)

**Important:** `actions/setup-node` with `registry-url` writes a project `.npmrc` that injects `_authToken=${NODE_AUTH_TOKEN}`. When `NODE_AUTH_TOKEN` is unset, npm resolves this to an empty token and fails with `ENEEDAUTH` instead of falling through to the OIDC exchange. Delete the file before publishing:

```yaml
permissions:
  contents: write
  id-token: write    # grants the OIDC token

steps:
  - uses: actions/setup-node@v6
    with:
      node-version: '20'
      registry-url: 'https://registry.npmjs.org'

  - run: npx releasekit release
    env:
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      # No NPM_TOKEN needed with OIDC
```

ReleaseKit detects OIDC availability automatically (`npm-auth: auto`). To force it:

```json
{
  "publish": {
    "npm": { "auth": "oidc" }
  }
}
```

---

## Prerelease Workflow

```yaml
# Manual dispatch for prereleases
on:
  workflow_dispatch:
    inputs:
      prerelease:
        description: 'Prerelease identifier (e.g. beta, rc)'
        required: true
        default: 'beta'

jobs:
  prerelease:
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

      - run: npx releasekit release --prerelease ${{ inputs.prerelease }}
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## Monorepo Targeted Release

Release only specific packages:

```bash
npx releasekit release --target @myorg/core,@myorg/cli
```

Or version all packages together:

```bash
npx releasekit release --sync
```

---

## Dry Run in CI

Useful for verifying pipeline setup before enabling real releases:

```yaml
- run: npx releasekit release --dry-run --json
```

`--dry-run` prints what would happen without modifying any files, creating tags, or publishing packages. `--json` emits structured output for inspection.
