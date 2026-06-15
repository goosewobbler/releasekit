# ReleaseKit GitHub Action

The repository exposes a composite GitHub Action at the repo root (`action.yml`).

Consumers should pin the major tag:

```yaml
uses: goosewobbler/releasekit@v0
```

> **Note:** ReleaseKit is pre-1.0. The floating `v0` tag tracks the latest `0.x` release; a `v1` tag will follow the 1.0 release. For stricter supply-chain hygiene, pin to a specific SHA (`@<commit-sha>`) — see GitHub's [security hardening guide](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions#using-third-party-actions).

## Modes

- `release` (default): runs the full unified release pipeline.
- `preview`: runs PR preview comment generation.
- `gate`: evaluates merged-PR labels and emits should-release/bump/scope outputs.
- `standing-pr-update`: creates or refreshes the standing release PR.
- `standing-pr-publish`: publishes from a merged standing release PR's manifest. Resolution order for which PR: the `pr` input, then the `pull_request` event payload, then the most recently merged standing PR via the GitHub API. Pass `pr` explicitly in dispatch funnels (e.g. `workflow_dispatch` routing for npm OIDC trusted publishing) — re-runs of a stale dispatch can otherwise infer a newer standing PR.
- `backfill`: regenerates release notes for already-released versions from git history, writing per-version files and/or updating GitHub release bodies. Dry-run unless `apply: true`. Best driven by `workflow_dispatch` for one-off backfills.

## Requirements

- Node.js 20+ must be available in the job. All GitHub-hosted runners include a compatible version by default. If you need a specific version, add `actions/setup-node` before this action.
- For npm publishing, run `actions/setup-node` with `registry-url: https://registry.npmjs.org` before this action so that `NODE_AUTH_TOKEN` is wired up correctly.

## Required permissions and env

### Release mode

- Recommended job permissions:
  - `id-token: write` (OIDC trusted publishing)
  - `contents: read` (checkout)
  - `contents: write` (git push + GitHub Releases)
- Required env:
  - `GITHUB_TOKEN`

### Preview mode

- Recommended job permissions:
  - `contents: read` (checkout)
  - `pull-requests: write` (posting/updating PR comments)
- Required env:
  - `GITHUB_TOKEN`

## Inputs

### Core

| Input | Default | Description |
|---|---|---|
| `mode` | `release` | `release`, `preview`, `gate`, `standing-pr-update`, `standing-pr-publish`, or `backfill` |
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
| `prerelease` | - | Prerelease identifier (e.g. `alpha`, `beta`) |
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
| `pr` | - | PR number override (also used by `standing-pr-publish`) |
| `repo` | - | `owner/repo` override |
| `preview-prerelease` | - | Force prerelease preview identifier |
| `preview-stable` | `false` | Force stable preview |
| `preview-dry-run` | `false` | Print markdown instead of posting |
| `preview-target` | - | Comma-separated package targets |

### Standing PR mode inputs

| Input | Default | Description |
|---|---|---|
| `pr` | - | Merged standing PR number (`standing-pr-publish`, when not triggered by a `pull_request` event) |
| `reconcile` | `false` | `standing-pr-update` only: bypass the skip-pattern guard. Set this for a post-release reconcile run, where HEAD is the just-pushed release commit (which matches the skip pattern). Without it the reconcile run no-ops and the standing PR keeps holding the just-published versions. |

### Backfill mode inputs

| Input | Default | Description |
|---|---|---|
| `package` | package.json name at `path` | Package to backfill |
| `path` | `.` | Package directory |
| `all` | `false` | Backfill every workspace package (mutually exclusive with `package`) |
| `from` | - | Earliest version to backfill (inclusive) |
| `to` | - | Latest version to backfill (inclusive) |
| `update-releases` | `false` | Update matching GitHub release bodies via `gh release edit` |
| `only-missing` | `false` | With `update-releases`, skip releases already carrying releasekit notes |
| `apply` | `false` | Apply changes (default: dry-run preview) |

`update-releases` needs `contents: write` permission and `GITHUB_TOKEN` (for `gh release edit`). Writing per-version files needs `notes.releaseNotes.file.dir` set in your config and, to commit them, a follow-up step.

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
      - uses: actions/setup-node@v6
        with:
          node-version: "24"
          registry-url: https://registry.npmjs.org
      - id: rk
        uses: goosewobbler/releasekit@v0
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
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: goosewobbler/releasekit@v0
        with:
          mode: preview
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Preview mode dry run (markdown only)

```yaml
jobs:
  preview:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - id: rk
        uses: goosewobbler/releasekit@v0
        with:
          mode: preview
          preview-dry-run: "true"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - run: |
          echo "${{ steps.rk.outputs.preview-markdown }}"
```

### Backfill mode (update GitHub release bodies)

Run on demand to regenerate notes for past releases. Dry-run by default — flip `apply` to `true` when the preview looks right.

```yaml
name: Backfill Release Notes

on:
  workflow_dispatch:
    inputs:
      apply:
        description: Apply changes (off = dry-run preview)
        type: boolean
        default: false

jobs:
  backfill:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: goosewobbler/releasekit@v0
        with:
          mode: backfill
          all: "true"
          update-releases: "true"
          only-missing: "true"
          apply: ${{ inputs.apply }}
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Versioning and distribution policy

- Action is distributed through Git tags:
  - immutable tags like `v1.0.0`
  - moving major alias like `v1`
- Consumers should reference `@v1`.
- Breaking changes publish under a new major alias (`v2`).
