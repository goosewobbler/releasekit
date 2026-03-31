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
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
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
| `release:patch` | Bump patch version |
| `release:minor` | Bump minor version |
| `release:major` | Bump major version |
| `release:stable` | Graduate a prerelease to stable |
| `release:prerelease` | Create a prerelease |
| `release:skip` | Suppress release on this PR |

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
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
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
      "major": "release:major",
      "minor": "release:minor",
      "patch": "release:patch",
      "skip": "release:skip"
    }
  }
}
```

Without a `release:patch/minor/major` label on the merged PR, no release is triggered. The `labels` block shown above reflects the defaults — omit it if your repository already uses those label names.

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
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - run: npm ci

      - run: npx releasekit preview
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

A ready-to-use template is available at [`templates/workflows/release-preview.yml`](../../../templates/workflows/release-preview.yml).

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
  - uses: actions/setup-node@v4
    with:
      node-version: '20'
      registry-url: 'https://registry.npmjs.org'

  - name: Strip setup-node auth from .npmrc (required for OIDC)
    run: |
      if [ -f .npmrc ]; then
        sed -i '/^\/\/.*:_authToken=/d; /^always-auth=/d' .npmrc
      fi

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
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
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
