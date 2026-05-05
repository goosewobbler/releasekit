# @releasekit/release

[![@releasekit/release](https://img.shields.io/badge/@releasekit-release-9feaf9?labelColor=1a1a1a&style=plastic)](https://www.npmjs.com/package/@releasekit/release)
[![Version](https://img.shields.io/npm/v/@releasekit/release?color=28a745&labelColor=1a1a1a)](https://www.npmjs.com/package/@releasekit/release)
[![Downloads](https://img.shields.io/npm/dw/@releasekit/release?color=6f42c1&labelColor=1a1a1a)](https://www.npmjs.com/package/@releasekit/release)

**Unified release pipeline: version, changelog, and publish in a single command.**

## Features

- **Single command** — runs version, notes, and publish as one pipeline
- **Programmatic orchestration** — calls each tool's API directly, no subprocesses
- **CI-friendly** — exits cleanly (code 0) when there are no releasable changes
- **Skippable steps** — skip notes, publish, git, or GitHub releases independently
- **Dry-run mode** — preview the full pipeline without side effects
- **JSON output** — structured results for scripting and CI integration
- **Monorepo support** — target specific packages or version all in sync

## Installation

**npm:**

```bash
npm install -g @releasekit/release
```

**pnpm:**

```bash
pnpm add -g @releasekit/release
```

> **Note:** This package is ESM only and requires Node.js 20+.

## Quick Start

```bash
# Preview what would happen
releasekit release --dry-run

# Run a full release
releasekit release

# Force a patch bump
releasekit release --bump patch

# Version and publish, skip changelog generation
releasekit release --skip-notes
```

## Pipeline

The release command runs three steps in order:

1. **Version** — analyse conventional commits and calculate the next semver bump
2. **Notes** — generate changelog from the version output *(skippable)*
3. **Publish** — git commit/tag, npm/cargo publish, GitHub release *(skippable)*

If no releasable changes are found after step 1, the command exits with code 0 and skips the remaining steps.

## CLI Reference

### `releasekit release`

| Flag | Description | Default |
|------|-------------|---------|
| `-c, --config <path>` | Path to config file | `releasekit.config.json` |
| `-d, --dry-run` | Preview all steps without side effects | `false` |
| `-b, --bump <type>` | Force bump type: `patch`, `minor`, `major`, `prerelease` | auto |
| `-p, --prerelease [id]` | Create prerelease version | — |
| `-s, --sync` | Synchronized versioning across all packages | `false` |
| `-t, --target <packages>` | Target specific packages (comma-separated) | all |
| `--scope <name>` | Resolve scope name to target packages from ci.scopeLabels config | — |
| `--branch <name>` | Git branch to push to | current branch |
| `--skip-notes` | Skip changelog generation | `false` |
| `--skip-publish` | Skip registry publishing and git operations | `false` |
| `--skip-git` | Skip git commit/tag/push | `false` |
| `--skip-github-release` | Skip GitHub release creation | `false` |
| `--skip-verification` | Skip post-publish verification | `false` |
| `-j, --json` | Output results as JSON | `false` |
| `-v, --verbose` | Verbose logging | `false` |
| `-q, --quiet` | Suppress non-error output | `false` |
| `--project-dir <path>` | Project directory | cwd |

### `releasekit init`

Create a default `releasekit.config.json` in the current directory.

```bash
releasekit init [--force]
```

Detects monorepo layout and sets `changelog.mode` accordingly. Adds `access: "public"` only for scoped packages (`@scope/name`), which npm defaults to restricted.

Use `--force` to overwrite an existing config file.

### `releasekit gate`

Check whether a release should proceed based on PR labels and config. Outputs JSON for CI integration.

| Flag | Description | Default |
|------|-------------|---------|
| `-c, --config <path>` | Path to config file | `releasekit.config.json` |
| `--scope <name>` | Resolve scope name to target packages from ci.scopeLabels config | — |
| `-j, --json` | Output results as JSON | `false` |
| `-v, --verbose` | Verbose logging | `false` |
| `-q, --quiet` | Suppress non-error output | `false` |
| `--project-dir <path>` | Project directory | cwd |

The gate command returns exit code 0 regardless of the decision — use the `should-release` output in your workflow.

### `releasekit preview`

Posts a release preview comment on a pull request showing what would be released if merged.

| Flag | Description | Default |
|------|-------------|---------|
| `-c, --config <path>` | Path to config file | `releasekit.config.json` |
| `-d, --dry-run` | Print comment markdown to stdout instead of posting | `false` |
| `-p, --prerelease [id]` | Force prerelease preview (auto-detected by default) | — |
| `--stable` | Force stable release preview (graduation from prerelease) | `false` |
| `--pr <number>` | PR number (auto-detected from GitHub Actions) | — |
| `--repo <owner/repo>` | Repository (auto-detected from `GITHUB_REPOSITORY`) | — |
| `--project-dir <path>` | Project directory | cwd |

The preview command reads PR labels to determine release behavior. See [CI Configuration](#ci-configuration) for label configuration.

## Usage Examples

### In CI (GitHub Actions)

```yaml
- name: Release
  run: releasekit release
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    # For OIDC trusted publishing: no npm token needed (recommended).
    # For token-based publishing: set NPM_TOKEN (or NODE_AUTH_TOKEN).
```

### Automated releases on push to main

```yaml
on:
  push:
    branches: [main]

jobs:
  release:
    if: "!contains(github.event.head_commit.message, '[skip ci]')"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v6
      - run: pnpm add -g @releasekit/release
      - run: releasekit release
```

### Monorepo with targeted release

```bash
# Release only specific packages
releasekit release --target @myorg/core,@myorg/cli

# Release all packages in sync
releasekit release --sync
```

### Prerelease workflow

```bash
# Create new prerelease from stable version
releasekit release --prerelease beta

# Increment existing prerelease version
releasekit release --bump prerelease
```

### Gate mode in CI

```yaml
jobs:
  gate:
    runs-on: ubuntu-latest
    outputs:
      should-release: ${{ steps.gate.outputs.should-release }}
      bump: ${{ steps.gate.outputs.bump }}
      gate-scope: ${{ steps.gate.outputs.gate-scope }}
      gate-target: ${{ steps.gate.outputs.gate-target }}
    steps:
      - uses: actions/checkout@v6

      - id: gate
        uses: goosewobbler/releasekit@v0
        with:
          mode: gate

  release:
    needs: gate
    if: needs.gate.outputs.should-release == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - run: releasekit release
        with:
          bump: ${{ needs.gate.outputs.bump }}
          target: ${{ needs.gate.outputs.gate-target }}
```

## Programmatic API

```typescript
import { runRelease, runGate } from '@releasekit/release';

// Full release
const result = await runRelease({
  dryRun: true,
  bump: 'minor',
  skipNotes: false,
  skipPublish: false,
  skipGit: false,
  skipGithubRelease: false,
  skipVerification: false,
  sync: false,
  json: false,
  verbose: false,
  quiet: false,
  projectDir: process.cwd(),
});

if (result) {
  console.log(`Released ${result.versionOutput.updates.length} packages`);
} else {
  console.log('No releasable changes');
}

// Gate check
const gateResult = await runGate({
  projectDir: process.cwd(),
  json: true,
});

console.log(`Should release: ${gateResult.shouldRelease}`);
console.log(`Bump: ${gateResult.bump}`);
console.log(`Scope: ${gateResult.scope}`);
console.log(`Target: ${gateResult.target}`);
```

## Configuration

Create a `releasekit.config.json` in your project root. Add `$schema` for editor autocompletion and validation:

```json
{
  "$schema": "https://goosewobbler.github.io/releasekit/schema.json",
  "version": {
    "preset": "angular",
    "packages": ["./"]
  }
}
```

The release command reads the `version`, `notes`, and `publish` sections. See the individual package READMEs for all available options:

- [@releasekit/version](../version/README.md) — versioning options
- [@releasekit/notes](../notes/README.md) — changelog options
- [@releasekit/publish](../publish/README.md) — publishing options

### CI Configuration

The `ci` section controls automation behavior:

```jsonc
{
  "ci": {
    // How releases are delivered
    "releaseStrategy": "direct",       // "manual" | "direct" | "standing-pr" | "scheduled"

    // What triggers a release
    "releaseTrigger": "label",         // "commit" | "label"

    // Enable/disable PR preview comments
    "prPreview": true,

    // Customise PR label names
    "labels": {
      "stable": "channel:stable",
      "prerelease": "channel:prerelease",
      "skip": "release:skip",
      "immediate": "release:immediate",
      "major": "bump:major",
      "minor": "bump:minor",
      "patch": "bump:patch"
    },

    // Map PR labels to package filters for scoped releases
    // Example: a PR with "scope:shared" label only releases matching packages
    "scopeLabels": {
      "scope:shared": "@myorg/shared-*",
      "scope:frontend": "@myorg/web-*"
    }
  }
}
```

#### Release Trigger

**`label`** (default) — A PR label (`bump:patch`, `bump:minor`, or `bump:major`) is required to trigger a release. The label determines the bump type. PRs without a release label will not trigger a release when merged.

**`commit`** — Conventional commits drive the bump type automatically. Every merge can trigger a release. Use the `release:skip` label to prevent a release, or `bump:major` to override the commit-derived bump to major.

Both modes support `channel:stable` and `channel:prerelease` as channel modifiers. `channel:stable` alone graduates any prerelease packages to their stable base version and skips packages that are already stable — no bump label required. `channel:prerelease` must be combined with a `bump:*` label — alone, it does not trigger a release.

> **Standing-pr strategy is different.** When `releaseStrategy: "standing-pr"`, labels on **feeder PRs** are advisory only — the standing PR itself is the canonical override surface (add `bump:major` etc. to the standing PR to drive the next release). To bypass the queue and ship one PR directly, label it `release:immediate`. See [CI setup → Label semantics in standing-pr mode](./docs/ci-setup.md#label-semantics-in-standing-pr-mode).

#### Release Strategy

| Strategy | Description |
|----------|-------------|
| `direct` | Release is triggered when a PR is merged to the main branch |
| `manual` | Releases are triggered manually (e.g. via `workflow_dispatch`) |
| `standing-pr` | Changes accumulate in a standing release PR, merged when ready |
| `scheduled` | Releases are triggered on a schedule *(planned)* |

#### Scope-Based Release

Use `scopeLabels` to filter which packages are released based on PR labels. This is useful for monorepos with distinct package groups.

When a PR has a matching scope label, only packages matching the pattern are included in the release:

```json
{
  "ci": {
    "scopeLabels": {
      "scope:shared": "@myorg/shared-*",
      "scope:ui": "@myorg/ui-*"
    },
    "defaultScope": "scope:shared"
  }
}
```

**Options:**

| Option | Description |
|--------|-------------|
| `scopeLabels` | Map of PR label names to package patterns |
| `defaultScope` | Fallback scope to use when no scope label is found (must reference a key in `scopeLabels`) |

**Usage:**
- `scope:shared` + `bump:minor` → Release only `@myorg/shared-*` packages with minor bump
- `scope:shared` + `scope:ui` → Release both matching scope groups
- `scope:shared` (no release label) → Release only shared packages, bump determined by conventional commits
- No scope label but `defaultScope` configured → Use default scope pattern

Multiple scope labels are combined with OR logic. Without a `release:*` label, conventional commits determine the version bump.

**Label conflicts:**

In label trigger mode, conflicting labels will block the release and post a comment explaining the issue:
- Multiple bump labels (`bump:major` + `bump:minor` + `bump:patch`) → blocked
- Conflicting release type (`channel:stable` + `channel:prerelease`) → blocked (both modes)

**How it works:**

- **Preview mode**: Reads labels directly from the PR
- **Release mode**: When triggered via `workflow_run` after a PR merge, releasekit finds the merged PR(s) for the HEAD commit and reads their labels automatically

**Example workflow configuration:**

```yaml
# Specify a fallback target - scope labels will filter to specific packages when found
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: goosewobbler/releasekit@v0
        with:
          mode: release
          # Fallback target - used when no scope label is found
          target: "@myorg/shared-*,@myorg/ui-*,@myorg/api-*"
```

With this setup, releasekit will use the specified packages as fallback. When a PR has a scope label, it will be used instead to filter to just those packages.

#### Standing PR Configuration

When `releaseStrategy: "standing-pr"`, the `ci.standingPr` block tunes the bot-maintained release PR. All keys are optional.

| Key | Default | Purpose |
|---|---|---|
| `branch` | `release/next` | Bot-maintained release branch name. Force-reset to `main` on every update. |
| `title` | `chore: release ${count} package(s)` | PR title template. Variables: `${count}`, `${version}`. Must start with a string matching `release.ci.skipPatterns` (default `chore: release `). |
| `labels` | `["release"]` | Labels applied to the PR. Maintainer-added `bump:*` / `scope:*` / `channel:*` labels on the standing PR are preserved across updates and drive the next release as overrides — see [Label semantics in standing-pr mode](./docs/ci-setup.md#label-semantics-in-standing-pr-mode). |
| `deleteBranchOnMerge` | `true` | Delete the release branch after publish completes. |
| `mergeMethod` | `merge` | `merge` \| `squash` \| `rebase`. |
| `editableNotes` | `false` | Wrap the release notes in editable markers; user edits are preserved across updates and flow through to publish. |
| `minAge` | (unset) | Duration string (`6h`, `30m`, `1d`). Until elapsed, `releasekit/standing-pr` status check reports `pending`. |
| `minPackages` | (unset) | Minimum distinct packages with releasable changes before a standing PR is created. Below threshold, an existing PR is closed. |

```json
{
  "ci": {
    "releaseStrategy": "standing-pr",
    "standingPr": {
      "branch": "release/next",
      "mergeMethod": "squash",
      "editableNotes": true,
      "minAge": "6h"
    }
  }
}
```

See [CI setup — Standing Release PR](./docs/ci-setup.md#standing-release-pr) for prerequisites (required GitHub repo setting, secrets), the workflow YAML, lifecycle behaviour, and troubleshooting.

### PR Preview

The `releasekit preview` command posts a comment on pull requests showing what would be released. It reads PR labels from GitHub and adapts its messaging based on `releaseStrategy` and `releaseTrigger`.

Add this workflow to `.github/workflows/release-preview.yml`:

```yaml
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
    name: Release Preview
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v6
        with:
          node-version: '20'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Release preview
        run: pnpm exec releasekit preview
        env:
          GITHUB_TOKEN: ${{ github.token }}
```

A template is also available at [`templates/workflows/release-preview.yml`](../../templates/workflows/release-preview.yml).

## Documentation

**Getting Started**
- [CI Setup](./docs/ci-setup.md) — GitHub Actions workflows (push, label, OIDC, PR preview, prerelease)

## License

MIT
