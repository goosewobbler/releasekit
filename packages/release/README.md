# @releasekit/release

> [!WARNING]
> 🚧 **Pre-1.0.0** — ReleaseKit is evolving fast and **💥 breaking changes are common**; it's **not production-ready** until `v1.0.0`. Pin exact versions. See the [main README](../../README.md) for details.

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

> **Note:** This package is ESM only and requires Node.js 22.12+.

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

In GitHub Actions it first applies `gate`'s decision to the labels of the merged PR the pushed commit came from, so it also exits 0 when they don't call for a release, and takes the bump, channel and scope from them otherwise. See [Merged-PR labels](../../docs/cli.md#merged-pr-labels).

## CLI Reference

Flags for every command are in the [CLI reference](../../docs/cli.md): [`release`](../../docs/cli.md#releasekit-release), [`preview`](../../docs/cli.md#releasekit-preview), [`gate`](../../docs/cli.md#releasekit-release-gate), [`standing-pr`](../../docs/cli.md#releasekit-standing-pr), [`refresh-after-release`](../../docs/cli.md#releasekit-refresh-after-release), [`backfill`](../../docs/cli.md#releasekit-release-backfill), [`init`](../../docs/cli.md#releasekit-init) and [`labels`](../../docs/cli.md#releasekit-labels).

## Usage Examples

### In CI (GitHub Actions)

```yaml
- name: Release
  run: pnpm exec releasekit release
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    # For OIDC trusted publishing: no npm token needed (recommended).
    # For token-based publishing: set NPM_TOKEN (or NODE_AUTH_TOKEN).
```

[`examples/ci/minimal`](../../examples/ci/minimal/release.yml) runs this on every push to `main`. [`examples/`](../../examples/README.md) has the other workflows.

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

`release` makes the gate's decision itself, so one release step is enough. Run `gate` as its own job to skip the release job's setup when nothing will release:

```yaml
jobs:
  gate:
    runs-on: ubuntu-latest
    outputs:
      should-release: ${{ steps.gate.outputs.should-release }}
    steps:
      - id: gate
        uses: goosewobbler/releasekit@v0
        with:
          mode: gate

  release:
    needs: gate
    if: needs.gate.outputs.should-release == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: goosewobbler/releasekit@v0
        with:
          mode: release
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
    "releaseStrategy": "direct",       // "manual" | "direct" | "standing-pr"

    // What triggers a release
    "releaseTrigger": "label",         // "commit" | "label"

    // Enable/disable PR preview comments
    "prPreview": true,

    // Map PR labels to package filters for scoped releases
    // Example: a PR with "scope:shared" label only releases matching packages
    "scopeLabels": {
      "scope:shared": "@myorg/shared-*",
      "scope:frontend": "@myorg/web-*"
    }
  }
}
```

Every `ci.*` key, including the label names under `ci.labels`, is in the [configuration reference](../../docs/configuration.md#ci).

#### Release Trigger

**`label`** (default) — A PR label (`bump:patch`, `bump:minor`, or `bump:major`) is required to trigger a release. The label determines the bump type. PRs without a release label will not trigger a release when merged.

**`commit`** — Conventional commits drive the bump type automatically. Every merge can trigger a release. Use the `release:skip` label to prevent a release, or `bump:major` to override the commit-derived bump to major.

Both modes support `release:graduate` and `channel:prerelease`. `release:graduate` alone graduates any prerelease packages to their stable base version and skips packages that are already stable — no bump label required (it's a standalone release-flow trigger). `channel:prerelease` makes the release a prerelease. With the `label` trigger it needs a `bump:*` label — alone, it does not trigger a release.

> **Standing-pr strategy is different.** When `releaseStrategy: "standing-pr"`, labels on **feeder PRs** are advisory only — the standing PR itself is the canonical override surface (add `bump:major` etc. to the standing PR to drive the next release). To bypass the queue and ship one PR directly, label it `release:immediate`. See [CI setup → Label semantics in standing-pr mode](./docs/ci-setup.md#label-semantics-in-standing-pr-mode).

#### Release Strategy

| Strategy | Description |
|----------|-------------|
| `direct` | Release is triggered when a PR is merged to the main branch |
| `manual` | Releases are triggered manually (e.g. via `workflow_dispatch`) |
| `standing-pr` | Changes accumulate in a standing release PR, merged when ready |

#### Scope-Based Release

Use `scopeLabels` to filter which packages are released based on PR labels. This is useful for monorepos with distinct package groups.

When the PR that decides the release has a matching scope label, only packages matching the pattern are included in the release:

```json
{
  "ci": {
    "scopeLabels": {
      "scope:shared": "@myorg/shared-*",
      "scope:ui": "@myorg/ui-*"
    }
  }
}
```

**Usage:**
- `scope:shared` + `bump:minor` → Release only `@myorg/shared-*` packages with minor bump
- `scope:shared` alone → Release only shared packages under the `commit` trigger, bump from conventional commits; no release under the `label` trigger
- No scope label → Release every package with releasable changes

A PR's first matching scope label applies. `--target` or `--scope` replace it.

**Label conflicts:**

Conflicting labels on a PR block the release, and `gate` comments on the PR to explain:
- Multiple bump labels (`bump:major` + `bump:minor` + `bump:patch`) → blocked in label trigger mode, and on a `release:immediate` PR in `standing-pr` strategy
- Conflicting release type (`release:graduate` + `channel:prerelease`) → blocked in both modes

**How it works:**

- **Preview mode**: Reads labels directly from the PR
- **Release and gate modes**: Read the labels of the merged PR the pushed commit came from. See [Merged-PR labels](../../docs/cli.md#merged-pr-labels).

#### Standing PR Configuration

When `releaseStrategy: "standing-pr"`, the `ci.standingPr` block tunes the bot-maintained release PR. All keys are optional; see [`ci.standingPr`](../../docs/configuration.md#cistandingpr) in the configuration reference.

```json
{
  "ci": {
    "releaseStrategy": "standing-pr",
    "standingPr": {
      "branch": "release/next",
      "mergeMethod": "squash",
      "minAge": "6h"
    }
  }
}
```

See [CI setup — Standing Release PR](./docs/ci-setup.md#standing-release-pr) for prerequisites (required GitHub repo setting, secrets), lifecycle behaviour, and troubleshooting. The workflow is [`examples/ci/standing-pr`](../../examples/ci/standing-pr/standing-pr.yml).

### PR Preview

The `releasekit preview` command posts a comment on pull requests showing what would be released. It reads PR labels from GitHub and adapts its messaging based on `releaseStrategy` and `releaseTrigger`.

Copy [`examples/ci/release-preview/release-preview.yml`](../../examples/ci/release-preview/release-preview.yml) to `.github/workflows/release-preview.yml`. Its preview step:

```yaml
- run: pnpm exec releasekit preview
  env:
    GITHUB_TOKEN: ${{ github.token }}
```

## Documentation

**Getting Started**
- [CI Setup](./docs/ci-setup.md) — how each CI setup works, including the standing PR
- [CI examples](../../examples/README.md) — the workflows, validated in CI

## License

MIT
