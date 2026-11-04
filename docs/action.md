# ReleaseKit GitHub Action

The repository exposes a composite GitHub Action at the repo root (`action.yml`).

Consumers should pin the major tag:

```yaml
uses: goosewobbler/releasekit@v0
```

> **Note:** ReleaseKit is pre-1.0. The floating `v0` tag tracks the latest `0.x` release; a `v1` tag will follow the 1.0 release. `vX.Y.Z` tags aren't immutable: each is moved onto a commit that adds the built action. For stricter supply-chain hygiene, pin the commit a `vX.Y.Z` tag points to (`@<commit-sha> # vX.Y.Z`) — see GitHub's [security hardening guide](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions#using-third-party-actions).

## Modes

- `release`: runs the release pipeline (version, notes, publish).
- `preview` (default): posts or updates the PR preview comment.
- `gate`: evaluates merged-PR labels and emits should-release/bump/scope outputs.
- `standing-pr-update`: creates or refreshes the standing release PR.
- `standing-pr-publish`: publishes from a merged standing release PR's manifest. Resolution order for which PR: the `pr` input, then the `pull_request` event payload, then the most recently merged standing PR via the GitHub API. Pass `pr` explicitly in dispatch funnels (e.g. `workflow_dispatch` routing for npm OIDC trusted publishing) — re-runs of a stale dispatch can otherwise infer a newer standing PR.
- `backfill`: regenerates release notes for already-released versions from git history, writing per-version files and/or updating GitHub release bodies. Dry-run unless `apply: true`. Best driven by `workflow_dispatch` for one-off backfills.
- `refresh-after-release`: refreshes the standing release PR after a direct release on `main`.

## Requirements

- The action checks out the repo (unless `skip-checkout`) and sets up Node with `actions/setup-node`, replacing any Node an earlier step set up. `node-version` defaults to `24`, whose npm supports OIDC trusted publishing; ReleaseKit needs 22.12+.
- It sets up pnpm with `pnpm/action-setup`: the version your `package.json` pins (`packageManager` or `devEngines.packageManager`), or the action's own if there's no pin. npm, Dart and Rust repos need no pnpm setup.
- For npm publishing, run `actions/setup-node` with `registry-url: https://registry.npmjs.org` before this action so that `NODE_AUTH_TOKEN` is wired up correctly.

## Required permissions and env

The action passes `github-token` (default: the workflow token) to ReleaseKit as `GITHUB_TOKEN` and `GH_TOKEN`, overriding either in your `env`. In a run that pushes, the action's checkout also persists it for git pushes, unless you set `ssh-key` or `skip-checkout`. Runs that push are `release`, the standing-PR modes, `refresh-after-release` and an applied `backfill`, never a dry run.

To bypass a ruleset, or to make those pushes start `on: push` workflows, pass a GitHub App token. It expires after an hour, so a release that runs longer can fail at its final push. Don't use a PAT: ReleaseKit recognises its own comments by bot authorship, so with a PAT `standing-pr-publish` refuses the release manifest, comments are re-posted on every run, and the standing-PR workflow can retrigger itself.

### Release mode

- Recommended job permissions:
  - `id-token: write` (OIDC trusted publishing)
  - `contents: write` (checkout, git push & GitHub Releases)
  - `pull-requests: write` (merged-PR labels, publish-failure reports and feeder-PR previews)

### Preview mode

- Recommended job permissions:
  - `contents: read` (checkout)
  - `pull-requests: write` (posting/updating PR comments)

### Gate mode

- Recommended job permissions:
  - `contents: read` (checkout)
  - `pull-requests: write` (label notices on the merged PR)

### Standing-PR and refresh modes

`standing-pr-update`, `standing-pr-publish` and `refresh-after-release` need the permissions and repo setting in [CI setup](../packages/release/docs/ci-setup.md#setup-requirements).

## Inputs

### Core

| Input | Default | Description |
|---|---|---|
| `mode` | `preview` | `release`, `preview`, `gate`, `standing-pr-update`, `standing-pr-publish`, `backfill`, or `refresh-after-release` |
| `config` | - | Path to `releasekit.config.json` |
| `project-dir` | `.` | Project directory |
| `dry-run` | `false` | Dry-run for `release`, `preview` and `backfill`; other modes fail if it's set |
| `github-token` | workflow token | Token for GitHub API calls and git pushes |
| `node-version` | `24` | Node.js version for the action's setup-node step |
| `npm-token` | - | npm token when not using OIDC (default: the job's `NPM_TOKEN`) |
| `summary` | `true` | Write a job summary for `release` and `gate` |
| `skip-checkout` | `false` | Skip the action's checkout. Check out a branch (not a detached HEAD) with `fetch-depth: 0`; the action rebases it onto `origin/<branch>`, or resets to it if the rebase fails. Pushes then use your checkout's credentials. |
| `json` | `false` | JSON output (release mode) |
| `verbose` | `false` | Verbose logs |
| `quiet` | `false` | Suppress non-error logs |

### Release mode inputs

| Input | Default | Description |
|---|---|---|
| `bump` | - | Force bump (`patch\|minor\|major\|prerelease`) |
| `prerelease` | - | Prerelease identifier (e.g. `alpha`, `beta`) |
| `stable` | `false` | Graduate prerelease packages to stable without bumping |
| `scope` | - | Scope name resolved to target packages from `ci.scopeLabels`; also used by `gate` |
| `ssh-key` | - | SSH deploy key for git pushes, used instead of `github-token` |
| `sync` | `false` | Synchronized versioning |
| `target` | - | Comma-separated package targets |
| `branch` | - | Override push branch |
| `npm-auth` | `auto` | `auto\|oidc\|token` |
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
| `has-changes` | Whether release detected updates (release mode) |
| `version-output` | `versionOutput` JSON string (release mode) |
| `tags` | Comma-separated tags (release mode) |
| `release-output` | Full release JSON output (release mode) |
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

Release-mode outputs need `json: "true"`; without it, `has-changes` is always `false` and the others are empty.

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
      pull-requests: write
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      # Node for the build, and registry-url for npm auth.
      - uses: actions/setup-node@v6
        with:
          node-version: 24
          registry-url: https://registry.npmjs.org
      # Install and build here.
      - id: rk
        uses: goosewobbler/releasekit@v0
        with:
          mode: release
          json: "true"
          # The action's own checkout would delete the build output.
          skip-checkout: "true"
      - name: Print tags
        env:
          TAGS: ${{ steps.rk.outputs.tags }}
        run: echo "Tags: $TAGS"
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

      # Through env: the markdown includes PR text, which `${{ }}` would splice into the script.
      - env:
          PREVIEW_MARKDOWN: ${{ steps.rk.outputs.preview-markdown }}
        run: echo "$PREVIEW_MARKDOWN"
```

### Backfill mode (update GitHub release bodies)

Run on demand to regenerate notes for past releases. Dry-run by default — flip `apply` to `true` when the preview looks right.

```yaml
- uses: actions/checkout@v6
  with:
    fetch-depth: 0 # backfill reads every tag
- uses: goosewobbler/releasekit@v0
  with:
    mode: backfill
    all: "true"
    update-releases: "true"
    apply: "false"
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

This fills empty release bodies and rewrites the ones backfill wrote before, and skips every other body. The Action has no `force` input. To replace notes releasekit published, add `only-missing: "true"`: it rewrites every body backfill didn't write, hand edits included, and skips the ones it did.

[`examples/ci/backfill`](../examples/ci/backfill/backfill.yml) has a full `workflow_dispatch` workflow that runs backfill through the CLI, with a `force` input.
