# ReleaseKit GitHub Action

The repository exposes a composite GitHub Action at the repo root (`action.yml`).

Consumers should pin the major tag:

```yaml
uses: goosewobbler/releasekit@v0
```

> **Note:** ReleaseKit is pre-1.0. The floating `v0` tag tracks the latest `0.x` release; a `v1` tag will follow the 1.0 release. `vX.Y.Z` tags aren't immutable: each is moved onto a commit that adds the built action. For stricter supply-chain hygiene, pin the commit a `vX.Y.Z` tag points to (`@<commit-sha> # vX.Y.Z`) — see GitHub's [security hardening guide](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions#using-third-party-actions).

## Modes

- `release`: runs the full unified release pipeline.
- `preview` (default): runs PR preview comment generation.
- `gate`: evaluates merged-PR labels and emits should-release/bump/scope outputs.
- `standing-pr-update`: creates or refreshes the standing release PR.
- `standing-pr-publish`: publishes from a merged standing release PR's manifest. Resolution order for which PR: the `pr` input, then the `pull_request` event payload, then the most recently merged standing PR via the GitHub API. Pass `pr` explicitly in dispatch funnels (e.g. `workflow_dispatch` routing for npm OIDC trusted publishing) — re-runs of a stale dispatch can otherwise infer a newer standing PR.
- `backfill`: regenerates release notes for already-released versions from git history, writing per-version files and/or updating GitHub release bodies. Dry-run unless `apply: true`. Best driven by `workflow_dispatch` for one-off backfills.
- `refresh-after-release`: refreshes the standing release PR after a direct release on `main`.

## Requirements

- The action checks out the repo (unless `skip-checkout`), then runs its own `pnpm/action-setup` and `actions/setup-node` (`node-version`, default `22`; ReleaseKit needs Node 22.12+). That replaces any Node version an earlier step set up.
- For npm publishing, run `actions/setup-node` with `registry-url: https://registry.npmjs.org` before this action so that `NODE_AUTH_TOKEN` is wired up correctly.

## Required permissions and env

The action passes `github-token` (default: the workflow token) to ReleaseKit as `GITHUB_TOKEN`, so a `GITHUB_TOKEN` in the step's `env` is ignored. Pass a PAT or App token as `github-token`.

### Release mode

- Recommended job permissions:
  - `id-token: write` (OIDC trusted publishing)
  - `contents: read` (checkout)
  - `contents: write` (git push & GitHub Releases)

### Preview mode

- Recommended job permissions:
  - `contents: read` (checkout)
  - `pull-requests: write` (posting/updating PR comments)

### Gate mode

- Recommended job permissions:
  - `contents: read`
  - `pull-requests: read` (reading the merged PR's labels)

### Standing-PR modes

`standing-pr-update` and `standing-pr-publish` need the permissions and repo setting in [CI setup](../packages/release/docs/ci-setup.md#setup-requirements).

## Inputs

### Core

| Input | Default | Description |
|---|---|---|
| `mode` | `preview` | `release`, `preview`, `gate`, `standing-pr-update`, `standing-pr-publish`, `backfill`, or `refresh-after-release` |
| `config` | - | Path to `releasekit.config.json` |
| `project-dir` | `.` | Project directory |
| `dry-run` | `false` | Dry-run for `release`, `preview` and `backfill`. `gate` is read-only; other modes fail if it's set |
| `github-token` | workflow token | Token for GitHub API calls (override with a PAT/App token when rulesets require it) |
| `node-version` | `22` | Node.js version for the action's setup-node step |
| `npm-token` | - | NPM token when not using OIDC; when unset, the job's `NPM_TOKEN` env is preserved |
| `summary` | `true` | Write a job summary for `release` and `gate` |
| `skip-checkout` | `false` | Skip the action's checkout steps only; setup-node, pnpm, and install still run. The repo must already be on disk (e.g. a prior checkout step). |
| `json` | `false` | JSON output (release mode). The release outputs stay empty without it |
| `verbose` | `false` | Verbose logs |
| `quiet` | `false` | Suppress non-error logs |

### Release mode inputs

| Input | Default | Description |
|---|---|---|
| `bump` | - | Force bump (`patch|minor|major|prerelease`) |
| `prerelease` | - | Prerelease identifier (e.g. `alpha`, `beta`) |
| `stable` | `false` | Graduate prerelease packages to stable without bumping |
| `scope` | - | Scope name resolved to target packages from `ci.scopeLabels` (also `gate`) |
| `ssh-key` | - | SSH deploy key; the action checks out over SSH so the push uses it (not on dry runs or in `gate`) |
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

`update-releases` needs `contents: write` permission (for `gh release edit`). Writing per-version files needs `notes.releaseNotes.file.dir` set in your config and, to commit them, a follow-up step.

## Outputs

| Output | Description |
|---|---|
| `success` | Whether action completed successfully |
| `mode` | Executed mode |
| `has-changes` | Whether release detected updates (release mode, needs `json: "true"`) |
| `version-output` | `versionOutput` JSON string (release mode, needs `json: "true"`) |
| `tags` | Comma-separated tags (release mode, needs `json: "true"`) |
| `release-output` | Full release JSON output (release mode, needs `json: "true"`) |
| `preview-markdown` | Preview markdown (preview mode + dry-run) |
| `preview-posted` | `true` when preview mode posted comment |
| `should-release` | Whether a release should proceed (gate mode) |
| `bump` | Resolved bump type (gate mode) |
| `gate-scope` | Resolved scope name (gate mode) |
| `gate-target` | Resolved target packages (gate mode) |
| `gate-stable` | Whether the release is a stable graduation (gate mode) |
| `standing-pr-action` | `created`, `updated`, `closed` or `noop` (standing-pr-update mode) |
| `standing-pr-number` | Standing PR number (standing-pr-update mode) |
| `standing-pr-url` | Standing PR URL (standing-pr-update mode) |

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
      # Only for registry-url: the action sets up its own Node version.
      - uses: actions/setup-node@v6
        with:
          registry-url: https://registry.npmjs.org
      - id: rk
        uses: goosewobbler/releasekit@v0
        with:
          mode: release
          json: "true"
      - name: Print tags
        run: echo "Tags: ${{ steps.rk.outputs.tags }}"
```

### Preview mode (post/update PR comment)

```yaml
name: Release Preview

on:
  pull_request:
    types: [opened, synchronize, reopened, labeled, unlabeled]

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

      # Through env, not inline: the markdown carries PR text, which inline would run as shell.
      - env:
          PREVIEW_MARKDOWN: ${{ steps.rk.outputs.preview-markdown }}
        run: echo "$PREVIEW_MARKDOWN"
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
```
