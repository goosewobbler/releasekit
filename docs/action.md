# ReleaseKit GitHub Action

The repository exposes a composite GitHub Action at the repo root (`action.yml`).

Consumers should pin the major tag:

```yaml
uses: goosewobbler/releasekit@v1
```

## Modes

- `release` (default): runs the full unified release pipeline.
- `preview`: runs PR preview comment generation.

## Required permissions and env

### Release mode

- Recommended job permissions:
  - `id-token: write` (OIDC trusted publishing)
  - `contents: write` (git push + GitHub Releases)
- Required env:
  - `GITHUB_TOKEN`

### Preview mode

- Recommended job permissions:
  - `contents: write` (posting/updating PR comments)
- Required env:
  - `GITHUB_TOKEN`

## Inputs

### Core

| Input | Default | Description |
|---|---|---|
| `mode` | `release` | `release` or `preview` |
| `config` | - | Path to `releasekit.config.json` |
| `project-dir` | `.` | Project directory |
| `dry-run` | `false` | Global dry-run toggle |
| `json` | `false` | JSON output (release mode) |
| `verbose` | `false` | Verbose logs |
| `quiet` | `false` | Suppress non-error logs |

### Release mode inputs

| Input | Default | Description |
|---|---|---|
| `bump` | - | Force bump (`patch|minor|major`) |
| `prerelease` | - | Prerelease identifier (or empty for default) |
| `sync` | `false` | Synchronized versioning |
| `target` | - | Comma-separated package targets |
| `branch` | - | Override push branch |
| `npm-auth` | `auto` | `auto|oidc|token` |
| `skip-notes` | `false` | Skip notes stage |
| `skip-publish` | `false` | Skip publish stage |
| `skip-git` | `false` | Skip git stage |
| `skip-github-release` | `false` | Skip GitHub Releases |
| `skip-verification` | `false` | Skip post-publish verification |

### Preview mode inputs

| Input | Default | Description |
|---|---|---|
| `pr` | - | PR number override |
| `repo` | - | `owner/repo` override |
| `preview-prerelease` | - | Force prerelease preview identifier |
| `preview-stable` | `false` | Force stable preview |
| `preview-dry-run` | `false` | Print markdown instead of posting |

## Outputs

| Output | Description |
|---|---|
| `success` | Whether action completed successfully |
| `mode` | Executed mode |
| `has-changes` | Whether release detected updates (release mode) |
| `version-output` | `versionOutput` JSON string (release mode) |
| `tags` | Comma-separated tags (release mode) |
| `release-output` | Full release JSON output (release mode) |
| `preview-markdown` | Preview markdown (preview mode + dry-run) |
| `preview-posted` | `true` when preview mode posted comment |

## Examples

### Release mode (full release)

```yaml
name: Release

on:
  workflow_dispatch:

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: write
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - id: rk
        uses: goosewobbler/releasekit@v1
        with:
          mode: release
          json: "true"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Print tags
        run: echo "Tags: ${{ steps.rk.outputs.tags }}"
```

### Preview mode (post/update PR comment)

```yaml
name: Release Preview

on:
  pull_request:

jobs:
  preview:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: goosewobbler/releasekit@v1
        with:
          mode: preview
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Preview mode dry run (markdown only)

```yaml
- id: rk
  uses: goosewobbler/releasekit@v1
  with:
    mode: preview
    preview-dry-run: "true"
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

- run: |
    echo "${{ steps.rk.outputs.preview-markdown }}"
```

## Versioning and distribution policy

- Action is distributed through Git tags:
  - immutable tags like `v1.0.0`
  - moving major alias like `v1`
- Consumers should reference `@v1`.
- Breaking changes publish under a new major alias (`v2`).

