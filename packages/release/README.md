# @releasekit/release

Unified release pipeline: version, changelog, and publish in a single command.

## Features

- **Single command** — runs version, notes, and publish as one pipeline
- **Programmatic orchestration** — calls each tool's API directly, no subprocesses
- **CI-friendly** — exits cleanly (code 0) when there are no releasable changes
- **Skippable steps** — skip notes, publish, git, or GitHub releases independently
- **Dry-run mode** — preview the full pipeline without side effects
- **JSON output** — structured results for scripting and CI integration
- **Monorepo support** — target specific packages or version all in sync

## Installation

```bash
npm install -g @releasekit/release
# or
pnpm add -g @releasekit/release
```

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
| `-b, --bump <type>` | Force bump type: `patch`, `minor`, `major` | auto |
| `-p, --prerelease [id]` | Create prerelease version | — |
| `-s, --sync` | Synchronized versioning across all packages | `false` |
| `-t, --target <packages>` | Target specific packages (comma-separated) | all |
| `--skip-notes` | Skip changelog generation | `false` |
| `--skip-publish` | Skip registry publishing and git operations | `false` |
| `--skip-git` | Skip git commit/tag/push | `false` |
| `--skip-github-release` | Skip GitHub release creation | `false` |
| `--skip-verification` | Skip post-publish verification | `false` |
| `-j, --json` | Output results as JSON | `false` |
| `-v, --verbose` | Verbose logging | `false` |
| `-q, --quiet` | Suppress non-error output | `false` |
| `--project-dir <path>` | Project directory | cwd |

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
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
      - run: npm install -g @releasekit/release
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
releasekit release --prerelease beta
```

## Programmatic API

```typescript
import { runRelease } from '@releasekit/release';

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
```

## Configuration

All configuration is shared via `releasekit.config.json`. The release command reads the `version`, `notes`, and `publish` sections as needed.

See the individual package READMEs for configuration details:

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
      "stable": "release:stable",
      "prerelease": "release:prerelease",
      "skip": "release:skip",
      "major": "release:major",
      "minor": "release:minor",
      "patch": "release:patch"
    }
  }
}
```

#### Release Trigger

**`label`** (default) — A PR label (`release:patch`, `release:minor`, or `release:major`) is required to trigger a release. The label determines the bump type. PRs without a release label will not trigger a release when merged.

**`commit`** — Conventional commits drive the bump type automatically. Every merge can trigger a release. Use the `release:skip` label to prevent a release, or `release:major` to override the commit-derived bump to major.

Both modes support `release:stable` and `release:prerelease` as modifiers.

#### Release Strategy

| Strategy | Description |
|----------|-------------|
| `direct` | Release is triggered when a PR is merged to the main branch |
| `manual` | Releases are triggered manually (e.g. via `workflow_dispatch`) |
| `standing-pr` | Changes accumulate in a standing release PR *(planned)* |
| `scheduled` | Releases are triggered on a schedule *(planned)* |

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
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Release preview
        run: npx releasekit preview
        env:
          GITHUB_TOKEN: ${{ github.token }}
```

A template is also available at [`templates/workflows/release-preview.yml`](../../templates/workflows/release-preview.yml).

## License

MIT
