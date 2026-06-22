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

      - uses: pnpm/action-setup@v5

      - uses: actions/setup-node@v6
        with:
          node-version: '24'
          cache: pnpm
          registry-url: 'https://registry.npmjs.org'

      - run: pnpm install --frozen-lockfile

      - run: pnpm exec releasekit release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # For OIDC trusted publishing (recommended) — no NPM_TOKEN needed.
          # For token-based publishing: NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

> **Using npm?** Drop the `pnpm/action-setup` step, set `cache: npm` on `setup-node`, and replace `pnpm install --frozen-lockfile` with `npm ci` and `pnpm exec` with `npx`.

---

## Label-Based Trigger

Only release when a PR is merged with a release label. Conventional commits determine the changelog entries; the label controls whether and at what level to bump.

**Required labels** (customisable in config):

| Label | Effect |
|-------|--------|
| `bump:patch` | Bump patch version |
| `bump:minor` | Bump minor version |
| `bump:major` | Bump major version |
| `channel:stable` | Graduate a prerelease to stable |
| `channel:prerelease` | Create a prerelease (requires bump:* label) |
| `release:skip` | Suppress release on this PR |

#### Create the labels

The labels above aren't created automatically. Create them — plus any `scope:*` and standing-PR labels your config adds — with:

```bash
releasekit labels sync
```

In CI, add `--check`: it exits non-zero on a missing label, catching the silent failure where a mistyped `bump:minor` just skips the release. See the [CLI reference](../../../docs/cli.md#releasekit-labels).

#### Label combinations

| Labels | Current version | Result |
|--------|-----------------|--------|
| `bump:patch` | `1.0.0` | `1.0.1` |
| `bump:minor` | `1.0.0` | `1.1.0` |
| `bump:major` | `1.0.0` | `2.0.0` |
| `bump:patch` | `1.0.0-next.6` | `1.0.1` — graduates prerelease to stable patch |
| `bump:minor` | `1.0.0-next.6` | `1.1.0` — graduates prerelease to stable minor |
| `bump:major` | `1.0.0-next.6` | `2.0.0` — graduates prerelease to stable major |
| `channel:prerelease` + `bump:patch` | `1.0.0` | `1.0.1-next.0` |
| `channel:prerelease` + `bump:minor` | `1.0.0` | `1.1.0-next.0` |
| `channel:prerelease` + `bump:major` | `1.0.0` | `2.0.0-next.0` |
| `channel:prerelease` + `bump:patch` | `1.0.0-next.6` | `1.0.1-next.0` — starts a fresh patch prerelease line |
| `channel:prerelease` + `bump:minor` | `1.0.0-next.6` | `1.1.0-next.0` — starts a fresh minor prerelease line |
| `channel:prerelease` + `bump:major` | `1.0.0-next.6` | `2.0.0-next.0` — starts a fresh major prerelease line |
| `channel:prerelease` alone | any | No release — add a `bump:*` label |
| `channel:stable` alone | `1.0.0-next.6` | `1.0.0` |
| `channel:stable` alone | `1.0.0` | No release — already at stable version |
| `channel:stable` + any `bump:*` | `1.0.0-next.6` | `1.0.0` — bump label is ignored during stable promotion |
| `channel:stable` + `bump:minor` | `1.0.0` | `1.1.0` — bump applies to already-stable packages |

> **`channel:prerelease` + `bump:*` escalates — it starts a *fresh* prerelease line at the chosen
> magnitude, even when the package is already on a prerelease.** So `bump:major` + `channel:prerelease`
> on `1.1.1-next.1` yields `2.0.0-next.0`, not `1.1.1-next.2`. To *iterate* an existing prerelease
> counter (`2.0.0-next.0` → `2.0.0-next.1`) without escalating, drop the `bump:*` label and let the
> bump come from commits with the prerelease channel applied — e.g. in standing-pr mode, put
> `channel:prerelease` alone on the standing PR.

> **`channel:prerelease` is a channel modifier, never a standalone release trigger.** It does
> nothing without a `bump:*` label in label/direct mode (it can't pick a magnitude on its own), and
> in standing-pr mode it simply sets the channel for the next merge. `channel:stable` is the one
> channel label that can stand alone in label/direct mode — but only because graduating a prerelease
> resolves to exactly one version (`1.0.0-next.6` → `1.0.0`); on an already-stable package it's a
> no-op. In standing-pr mode the *merge* is the trigger, so both channel labels are pure modifiers
> there.

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

      - uses: pnpm/action-setup@v5

      - uses: actions/setup-node@v6
        with:
          node-version: '24'
          cache: pnpm
          registry-url: 'https://registry.npmjs.org'

      - run: pnpm install --frozen-lockfile

      - run: pnpm exec releasekit release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

> **Using npm?** Drop the `pnpm/action-setup` step, set `cache: npm` on `setup-node`, and replace `pnpm install --frozen-lockfile` with `npm ci` and `pnpm exec` with `npx`.

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

### Scope labels

For monorepos, scope labels let a single PR target a subset of packages without naming each one. Map a label to a glob of package names in `ci.scopeLabels`:

```json
{
  "ci": {
    "releaseTrigger": "label",
    "scopeLabels": {
      "scope:core": "@myorg/*",
      "scope:docs": "docs/**",
      "scope:cli": "@myorg/cli"
    }
  }
}
```

When a PR is merged with a `scope:*` label, the gate resolves the glob and releases only the matching packages. Without a scope label, the gate falls back to releasing all packages with releasable changes since the last tag.

The CLI accepts `--scope <name>` to apply the same resolution from the command line:

```bash
pnpm exec releasekit release --scope core
# or: npx releasekit release --scope core
```

`--scope` and `--target` are mutually exclusive. Use `--target @myorg/foo,@myorg/bar` when you want explicit package names without going through the label map.

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

      - uses: pnpm/action-setup@v5

      - uses: actions/setup-node@v6
        with:
          node-version: '24'
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - run: pnpm exec releasekit preview
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

> **Using npm?** Drop the `pnpm/action-setup` step, set `cache: npm` on `setup-node`, and replace `pnpm install --frozen-lockfile` with `npm ci` and `pnpm exec` with `npx`.

A ready-to-use template is available at [`templates/workflows/release-preview.yml`](../../../templates/workflows/release-preview.yml).

---

## Standing Release PR

Accumulate release changes in a persistent "standing" PR that auto-updates as commits land on `main`. Maintainers review and merge the PR when ready to release.

**Benefits:**
- Changes accumulate in a single PR — easier code review for release notes and version decisions
- Merge controls timing — release when business/product goals align
- Can coexist with label-triggered direct releases (see [combining strategies](#combining-standing-pr-with-label-triggered-direct-releases) below)

### Setup requirements

Standing PRs need configuration in three places: a repo setting, workflow permissions, and (optionally) secrets.

**Repo setting (required):**

Settings → Actions → General → Workflow permissions → enable **"Allow GitHub Actions to create and approve pull requests"**.

Without this, `standing-pr update` fails on first run with:

```
POST /repos/owner/repo/pulls - 403
GitHub Actions is not permitted to create or approve pull requests.
```

The `pull-requests: write` permission in the workflow is necessary but not sufficient — this is a separate org/repo-level toggle.

**Workflow permissions** (in the workflow YAML):

```yaml
permissions:
  contents: write       # push to release branch, create tags
  pull-requests: write  # create/update/close standing PR and comments
  id-token: write       # npm OIDC trusted publishing
  statuses: write       # post the releasekit/standing-pr status check
```

**Secrets:**

| Secret | Used by | When required |
|---|---|---|
| `GITHUB_TOKEN` | both jobs | Always (auto-provided). |
| `NPM_TOKEN` | `publish-release` | Only if not using OIDC. With OIDC, omit it entirely. |
| `OLLAMA_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | `update-release-pr` | If `notes.releaseNotes.llm` is configured. Without it, LLM enhancement falls back to ungrouped output (logged as a warning, not a failure). |

**Branch protection:** if `release/next` is protected, the bot's force-push will fail. Either leave the release branch unprotected or grant the bot bypass permissions.

### Configuration

```json
{
  "ci": {
    "releaseStrategy": "standing-pr",
    "standingPr": {
      "branch": "release/next",
      "mergeMethod": "squash"
    }
  }
}
```

All `ci.standingPr.*` options:

| Field | Default | Purpose |
|---|---|---|
| `branch` | `release/next` | Bot-maintained release branch name. Force-reset to main on every update. |
| `title` | `chore: release ${count} package(s)` | PR title template. Variables: `${count}` (package count), `${version}` (first updated package version). **Must start with a string that matches `release.ci.skipPatterns`** (default `chore: release `) — otherwise the squash-merge commit will trigger another standing-pr update on itself. |
| `labels` | `["release"]` | Labels applied to the standing PR. Do not overlap with `bump:*` or `release:*` labels — those would cause the label-driven release flow to fire on the standing PR's merge. |
| `deleteBranchOnMerge` | `true` | Delete `release/next` after publish completes. |
| `mergeMethod` | `merge` | `merge` \| `squash` \| `rebase`. Squash recommended — produces a single `chore: release …` commit on main that the skip-pattern guard recognises. |
| `minAge` | (unset) | Duration string (`6h`, `30m`, `1d`). Until elapsed, the `releasekit/standing-pr` status check reports `pending` with a countdown. Combined with branch protection on the status check, blocks early merges. Time baseline is `firstUpdatedAt` — the PR's first creation timestamp, preserved across updates. |
| `minPackages` | (unset) | Minimum distinct packages with releasable changes before a standing PR is created. Below the threshold, an open PR is closed with an explanatory comment and no new PR is created until the threshold is met. |

### Workflow

`standing-pr.yml` runs alongside any existing release workflow:

```yaml
# .github/workflows/standing-pr.yml
# Requires: "Allow GitHub Actions to create and approve pull requests"
# enabled at Settings → Actions → General → Workflow permissions.
name: Standing Release PR

on:
  push:
    branches: [main]
  pull_request:
    # closed: publish on merge. labeled/unlabeled: apply bump/scope/channel override labels to
    # the OPEN standing PR immediately (#336); also the release:retry path on the merged PR.
    # edited: a maintainer ticked/unticked packages in the PR's selection region — re-run so the
    # held-back set applies (the bot's own body edits are filtered by the sender guard below).
    types: [closed, labeled, unlabeled, edited]
    branches: [main]
  schedule:
    - cron: '0 * * * *'  # Hourly — re-evaluates minAge status check as time passes

concurrency:
  group: standing-release-pr
  cancel-in-progress: false

permissions:
  contents: write
  pull-requests: write
  id-token: write
  statuses: write

jobs:
  update-release-pr:
    name: Update Release PR
    # push/schedule rebuild the PR; a label change or selection-region edit on the OPEN standing PR
    # re-runs the update so bump/scope/channel overrides and held-back packages take effect within
    # seconds. `state == 'open'` keeps this off the merged-PR label events that drive publish/retry.
    # The `sender.type != 'Bot'` guard is load-bearing for `edited`: the update rewrites the PR body
    # (an `edited` event), so without it the bot would re-trigger forever. Match on type, not a
    # hardcoded `github-actions[bot]` login, so a custom GitHub App token (its own `*[bot]` login) is
    # filtered too. The `release/` prefix is hardcoded (workflow `if` can't read config) — in-step config is authoritative.
    if: >-
      github.event_name == 'push' ||
      github.event_name == 'schedule' ||
      (
        github.event_name == 'pull_request' &&
        (
          github.event.action == 'labeled' ||
          github.event.action == 'unlabeled' ||
          github.event.action == 'edited'
        ) &&
        github.event.pull_request.state == 'open' &&
        startsWith(github.event.pull_request.head.ref, 'release/') &&
        github.event.sender.type != 'Bot'
      )
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
          token: ${{ github.token }}

      - uses: pnpm/action-setup@v5

      - uses: actions/setup-node@v6
        with:
          node-version: '24'
          cache: pnpm
          registry-url: 'https://registry.npmjs.org'

      - run: pnpm install --frozen-lockfile

      - name: Configure git
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"

      - run: pnpm exec releasekit standing-pr update
        env:
          GITHUB_TOKEN: ${{ github.token }}
          # Uncomment the env var matching your notes.releaseNotes.llm.provider.
          # Without it, LLM enhancement falls back to ungrouped output.
          # OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          # ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          # OLLAMA_API_KEY: ${{ secrets.OLLAMA_API_KEY }}

  publish-release:
    name: Publish Release
    # action == 'closed' matters: with `labeled` subscribed above, a label added to the
    # already-merged standing PR would otherwise re-match this job and publish unvalidated.
    if: >
      github.event_name == 'pull_request' &&
      github.event.action == 'closed' &&
      github.event.pull_request.merged == true &&
      startsWith(github.event.pull_request.head.ref, 'release/')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
          token: ${{ github.token }}

      - uses: pnpm/action-setup@v5

      - uses: actions/setup-node@v6
        with:
          node-version: '24'
          cache: pnpm
          registry-url: 'https://registry.npmjs.org'

      - run: pnpm install --frozen-lockfile

      - name: Configure git
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"

      - run: pnpm exec releasekit standing-pr publish
        env:
          GITHUB_TOKEN: ${{ github.token }}
          # With OIDC trusted publishing (recommended) NODE_AUTH_TOKEN is
          # unnecessary. With token-based npm auth, uncomment the next line:
          # NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

  # Maintainer-invoked retry after a partial-publish failure: apply `release:retry` to the
  # MERGED standing PR (label events fire on closed PRs). Publishing is idempotent — versions
  # already on the registry are skipped, and tags / GitHub releases are only created once the
  # publish succeeds — so the retry completes exactly what the failed run left unfinished.
  retry-publish:
    name: Retry Publish
    if: >
      github.event_name == 'pull_request' &&
      github.event.action == 'labeled' &&
      github.event.label.name == 'release:retry' &&
      github.event.pull_request.merged == true &&
      startsWith(github.event.pull_request.head.ref, 'release/')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
          token: ${{ github.token }}
          ref: main  # the standing PR's branch is deleted on merge; publish from main

      - uses: pnpm/action-setup@v5

      - uses: actions/setup-node@v6
        with:
          node-version: '24'
          cache: pnpm
          registry-url: 'https://registry.npmjs.org'

      - run: pnpm install --frozen-lockfile

      - name: Configure git
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"

      - run: pnpm exec releasekit standing-pr publish --pr ${{ github.event.pull_request.number }}
        env:
          GITHUB_TOKEN: ${{ github.token }}
          # Same auth note as publish-release above.
          # NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

      # Remove the label so each application is exactly one retry; re-apply to retry again.
      - name: Remove retry label
        if: always()
        run: gh api -X DELETE "repos/${{ github.repository }}/issues/${{ github.event.pull_request.number }}/labels/release%3Aretry" || true
        env:
          GH_TOKEN: ${{ github.token }}
```

> **Using npm?** Drop the `pnpm/action-setup` step, set `cache: npm` on `setup-node`, and replace `pnpm install --frozen-lockfile` with `npm ci` and `pnpm exec` with `npx`.

### How it works

1. **Update → PR:** On every push to `main`, `standing-pr update` runs a dry-run version analysis against commits since the last release tag. If there are releasable changes, it force-resets `release/next` from `main`, writes the version bumps and regenerated changelog/release notes, force-pushes, and creates or updates the standing PR with the version table and notes.
2. **Merge → publish:** Maintainers merge the standing PR when ready. The `pull_request.closed` trigger fires `standing-pr publish`, which reads the release manifest from the bot's PR comment and publishes the packages — no second version analysis is run, so the publish reflects exactly what was reviewed.
3. **Recurring re-evaluation:** The hourly `schedule` trigger re-runs `update`, which is essentially free when nothing has changed but advances the `minAge` countdown so the status check transitions from `pending` to `success` as time passes.

Use `channel:stable` and `channel:prerelease` labels on **the standing PR itself** to control release type during merge.

### Lifecycle and edge cases

- **No releasable commits since last release:** the standing PR is closed with an explanatory comment. It reopens automatically when releasable commits land.
- **Dependabot and other `chore` commits:** trigger the workflow but are not releasable on their own under the conventional preset. If other releasable commits already exist since the last release, the dependabot changes are bundled into the existing standing PR. If not, the workflow noops — no PR is created from dependabot alone.
- **Coexistence with label-driven releases:** safe by design. The label-driven path publishes immediately and writes a `chore: release …` commit (with `[skip ci]`) which the standing PR's skip-pattern guard (`release.ci.skipPatterns`, default `["chore: release "]`) recognises and skips. The standing PR resets fresh from `main` on the next non-release commit.
- **CI concurrency caveat:** if `ci.yml` uses `cancel-in-progress: true` on the `main` branch concurrency group, sequential merges will cancel each other's CI. Any release workflow gated on `workflow_run` completion will then silently skip for the cancelled run. Use a per-SHA group for push events:

  ```yaml
  concurrency:
    group: ci-${{ github.workflow }}-${{ github.event_name == 'pull_request' && github.event.pull_request.number || github.sha }}
    cancel-in-progress: true
  ```

  Each main-branch SHA gets its own group (so nothing is cancelled), while PR runs still cancel on new pushes.
- **Status check `releasekit/standing-pr`:** posted on the release branch HEAD after each update. States: `success` (ready to merge), `pending` (one or more gates not yet satisfied — typically `minAge`). Configure as a required check in branch protection on the standing PR's base branch if you want gates enforced at merge time.

### Label semantics in standing-pr mode

Labels behave differently in standing-pr mode than in direct mode. There are two surfaces.

**1. Feeder PRs (PRs being merged into `main`)** — labels are **advisory**.

`bump:*`, `scope:*`, `channel:stable`, and `channel:prerelease` on a feeder PR are shown in the preview comment so reviewers know they were noticed, but they do **not** drive behavior on merge. Bumps for the standing PR come from conventional commits across the union of queued changes; scope is global (the standing PR aggregates everything).

**2. The standing PR itself** — labels are the **canonical override surface**.

A maintainer can edit labels directly on the standing PR (via the GitHub UI or `gh pr edit <n> --add-label bump:major`). Adding or removing a label re-runs `standing-pr update` immediately (the `pull_request` `labeled`/`unlabeled` trigger), so the recomputed version table and status check reflect the new labels within seconds — no waiting for the next push or the hourly cron. The update reads those labels and applies them as overrides:

| Label on standing PR | Effect |
|---|---|
| `bump:patch` / `bump:minor` / `bump:major` | Forces that bump magnitude, overriding what conventional commits would otherwise produce. |
| `scope:foo` (per `ci.scopeLabels`) | Limits the release to scoped packages on the next update. |
| `channel:stable` | Graduates a prerelease to stable. |
| `channel:prerelease` | Switches the standing PR to prerelease versioning. |

Conflicts (e.g. both `bump:patch` and `bump:major`) surface as a `pending` `releasekit/standing-pr` status check on the release branch and a workflow warning. The override is dropped (falls back to commit-driven) until the conflict is resolved by removing one of the labels.

The `standing-pr update` workflow **preserves maintainer-added labels across runs** — labels you add stick until you remove them.

**Ad-hoc package selection.** The standing PR body carries a **Packages to release** checklist — one ticked row per changed package. Untick a package to hold it back from the next release and save; the `edited` trigger re-runs `standing-pr update`, which excludes it from the version bump entirely (no orphan version lands on `main`) and records the held-back set in the manifest. The choice survives later pushes — a held-back package re-renders as an unticked row until you re-tick it. The package each row refers to is read from its `<!-- rk-sel:… -->` marker comment, so keep those intact. Unticking a member of an `independent` group, or a prerequisite still needed by a ticked target, surfaces a ⚠️ warning in the body; members of a lockstep (`fixed`/`linked`) group can't be held back individually and re-tick automatically. (Sync releases ship atomically and carry no checklist.)

**Staleness guard.** The manifest records the override labels it was computed under. If the standing PR's labels are changed and it's merged before the triggered update re-runs (a narrow race), `standing-pr publish` detects that the merged PR's override labels no longer match the manifest and **refuses to publish** rather than shipping a release the labels no longer describe — re-run `standing-pr update` and merge again (or apply the retry label after updating). So a mismatched manifest can never be released, even though merge itself isn't blocked.

**Why this design**: labels live in one canonical place. There's no question about which feeder PR's bump label "wins" when multiple PRs disagree — there is only the standing PR. Provenance is GitHub's own audit log (`gh pr view <n> --json events`).

> **Graduating to 1.0.0 is opt-in.** Pre-1.0, a conventional breaking change auto-bumps the 0.x minor, not `1.0.0` (see [`version.zeroMajor`](../../../docs/configuration.md#versionzeromajor)). To cut `1.0.0`, add the **`bump:major`** label to the standing PR — an explicit override always graduates.

#### Bypassing the standing PR for one merge

To ship a single PR directly without queueing it, label it **`release:immediate`** (configurable via `ci.labels.immediate`). Companion labels work normally:

| Label combination on the feeder PR | Result |
|---|---|
| `release:immediate` alone | Direct release; bump magnitude from conventional commits in the PR. |
| `release:immediate` + `bump:minor` | Direct release at minor magnitude. |
| `release:immediate` + `scope:foo` | Direct release of only the scoped packages. |
| `release:immediate` + `channel:prerelease` | Direct prerelease. |

The `immediate-release` job in `standing-pr.yml` handles this:
1. Runs `releasekit release` (versioning + notes + publish).
2. Runs `releasekit standing-pr update` to reconcile the standing PR — released packages drop out of the queue, anything still queued stays.

Result: the standing PR is up-to-date by the time the workflow exits — no staleness window.

#### Retrying a failed publish

If a standing-PR publish fails partway through (some packages on the registry, no tags/GitHub release), add the **`release:retry`** label to the **merged** standing PR. The `retry-publish` job in the workflow template above:

1. Validates via its `if` guard that the PR is a merged standing PR and the label is `release:retry` — note the guard hardcodes the label name (workflow `if` expressions can't read releasekit config), so renaming the label via `ci.labels.retry` requires updating the guard to match.
2. Re-runs the manifest-driven publish for that PR (`standing-pr publish --pr <n>`) — idempotent, so it re-publishes only the packages that did not land, then pushes tags and creates GitHub releases.
3. Removes the label, so each application is exactly one retry; re-apply it to retry again.

Applying the label to a non-standing or unmerged PR simply doesn't match the job's guard — nothing runs. A successful retry resolves the partial-publish failure report and clears the supersede warning from the next standing PR. Full recovery walkthrough: [Recovering from a failed publish](../../../docs/troubleshooting.md#recovering-from-a-failed-publish). (For reference, releasekit's own repo implements the same flow as a standalone [`release-retry.yml`](../../../.github/workflows/release-retry.yml) that dispatches its release workflow — useful if your publish runs in a separate dispatchable workflow.)

#### Previewing and editing release notes

By default the standing PR generates only changelogs — LLM release notes are produced at **publish** time, so the workflow never depends on LLM availability on every push. To review and **edit** the release notes *before* merging, label the standing PR **`release:preview-notes`** (configurable via `ci.labels.previewNotes`).

1. Add the label to the standing PR (`gh pr edit <n> --add-label release:preview-notes`).
2. On the next `standing-pr update` — the next push to `main`, the hourly `schedule`, or a manual re-run of the workflow — releasekit generates LLM release notes into an editable **`## Release Notes`** region in the PR body, with one block per package delimited by `<!-- releasekit-notes:<package> -->` markers.
3. Edit the prose between the markers directly in the PR description. **Keep the marker comments** — they delimit the region that's read back.
4. Merge as usual. The edited notes become the GitHub release body, winning per package over freshly generated notes.

Your edits are **preserved across update runs**: notes are generated once when the label is first applied, then carried over (not regenerated) on later pushes — so a push to `main` while you're mid-edit won't clobber your text. A package added to the queue *after* you started gets fresh notes; existing blocks keep your edits. Requires `notes.releaseNotes.llm` configured and the provider secret available to the `update-release-pr` job (same as publish-time generation).

This is a standing-pr-only feature — it needs a durable pre-publish artifact (the PR body) to edit. In `direct`/`manual` mode, edit the GitHub Release after it's published instead. (A manual-mode draft-then-dispatch flow is tracked in [#319](https://github.com/goosewobbler/releasekit/issues/319).)

> **Edit race:** a standing-PR update reads the live PR body, merges your edits, and rewrites it. An edit saved in the narrow window between that read and rewrite can be overwritten. Updates are infrequent (push/schedule-driven), so in practice this is rare — re-apply the edit if it happens.

### Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `403 — GitHub Actions is not permitted to create or approve pull requests` | Repo setting not enabled. See [Setup requirements](#setup-requirements). |
| `OLLAMA_API_KEY is not set. … Returning entries ungrouped.` | LLM secret not passed to the `update-release-pr` job. Add it to the job's `env:` block (or the equivalent for your provider). |
| `error: too many arguments for 'preview'` | Pre-fix releasekit where `standing-pr` was missing from `cli.ts`. Upgrade `@releasekit/release`. |
| Standing PR never appears despite merges | Check, in order: (1) the GitHub repo setting; (2) the head commit doesn't match `release.ci.skipPatterns`; (3) there are releasable conventional commits (`feat:`, `fix:`) since the last tag; (4) the `update-release-pr` job logs — they print the dry-run version output. |
| Standing PR keeps closing immediately | `minPackages` is set higher than the current change count. Either lower the threshold or wait for more package changes to accumulate. |
| Standing PR ignores my `bump:*` label on a feeder PR | By design — feeder labels are advisory in standing-pr mode. Add the label to the standing PR itself, or use `release:immediate` to bypass the queue. |
| Standing PR shows `pending` status `Conflicting bump labels…` | Two conflicting labels on the standing PR (e.g. `bump:patch` + `bump:major`). Remove one and re-run `standing-pr update`. |
| Added `release:preview-notes` but no notes appear | The region is written on the next `standing-pr update` (push to `main`, the hourly `schedule`, or a manual re-run) — not the instant the label is applied. Also confirm `notes.releaseNotes.llm` is set and the provider secret reaches the `update-release-pr` job. |
| Edited release notes didn't ship | Confirm you edited *inside* the `<!-- releasekit-notes:<package> -->` markers and left them intact — content outside the markers isn't read back. |
| Force-push to `release/next` fails | Branch is protected. Remove protection on the release branch, or grant the bot bypass. |
| `minAge` never advances | The hourly `schedule` trigger isn't running. Confirm the workflow has a `schedule:` block and that the repo isn't paused (GitHub disables `schedule` on inactive repos after 60 days). |

---

## Combining queued and immediate releases

Standing-pr mode handles both batched and one-off releases through a single workflow file (`standing-pr.yml`). There is no separate `release.yml` to wire up.

**How it works:**

- A PR merged **without** `release:immediate` → `standing-pr update` accumulates the change into the standing PR. Any `bump:*` / `scope:*` / `channel:*` labels on the feeder PR are advisory only (see [Label semantics](#label-semantics-in-standing-pr-mode) above).
- A PR merged **with** `release:immediate` → the `immediate-release` job in `standing-pr.yml` runs `releasekit release` directly (honouring companion `bump:*` / `scope:*` / `channel:*` labels), then chains `standing-pr update` to reconcile the standing PR.
- The standing PR itself only publishes when its own branch (`release/next`) is merged by a maintainer — there's no double-publish risk.

**Decision guide:**

| Situation | Action |
|-----------|--------|
| Routine feature — batch with others | Merge PR without a label. Bumps come from conventional commits. |
| Critical fix that needs to ship now | Add `release:immediate` (optionally `+ bump:patch`) to the PR. |
| Adjust the standing PR's bump magnitude | Add `bump:major` (etc.) to the standing PR itself; the next update applies it. |
| Promote accumulated prereleases to stable | Add `channel:stable` to the standing PR and merge it. |
| Retry a publish that failed partway | Add `release:retry` to the **merged** standing PR. |

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
  - uses: pnpm/action-setup@v5

  - uses: actions/setup-node@v6
    with:
      node-version: '24'
      cache: pnpm
      registry-url: 'https://registry.npmjs.org'

  - run: pnpm install --frozen-lockfile

  - run: pnpm exec releasekit release
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

## pub.dev Publishing (Dart / Flutter)

ReleaseKit publishes Dart and Flutter packages to pub.dev. Set `publish.pub.enabled: true` in your config and, if the repo contains Flutter packages, ReleaseKit detects them automatically from the `environment.flutter` key in `pubspec.yaml`.

### OIDC automated publishing (recommended)

pub.dev supports automated publishing without a token if you configure a publisher on the pub.dev package admin page:

1. Go to the package page on pub.dev → **Admin** → **Automated publishing**.
2. Enable **GitHub Actions publishing** and set the repository, workflow file, and (optionally) environment.
3. No secret is required — the workflow gets `id-token: write` permission and pub.dev validates the OIDC token at publish time.

```yaml
permissions:
  contents: write
  id-token: write   # required for pub.dev OIDC publishing
```

ReleaseKit will run `dart pub publish --force` (or `flutter pub publish --force` for Flutter packages) directly. No credential setup step is needed.

### Token-based publishing

If OIDC is not configured, set the `PUB_TOKEN` environment variable. ReleaseKit will run `dart pub token add https://pub.dev --env-var PUB_TOKEN` before publishing.

```yaml
- run: pnpm exec releasekit release
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    PUB_TOKEN: ${{ secrets.PUB_TOKEN }}
```

### Config

```json
{
  "publish": {
    "pub": {
      "enabled": true,
      "publishOrder": ["my_core_package", "my_app_package"]
    }
  }
}
```

`publishOrder` is optional — use it to control the sequence when packages within the same release have inter-dependencies.

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

      - uses: pnpm/action-setup@v5

      - uses: actions/setup-node@v6
        with:
          node-version: '24'
          cache: pnpm
          registry-url: 'https://registry.npmjs.org'

      - run: pnpm install --frozen-lockfile

      - run: pnpm exec releasekit release --prerelease ${{ inputs.prerelease }}
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

> **Using npm?** Drop the `pnpm/action-setup` step, set `cache: npm` on `setup-node`, and replace `pnpm install --frozen-lockfile` with `npm ci` and `pnpm exec` with `npx`.

---

## Monorepo Targeted Release

Release only specific packages:

```bash
pnpm exec releasekit release --target @myorg/core,@myorg/cli
# or: npx releasekit release --target @myorg/core,@myorg/cli
```

Or version all packages together:

```bash
pnpm exec releasekit release --sync
# or: npx releasekit release --sync
```

---

## Dry Run in CI

Useful for verifying pipeline setup before enabling real releases:

```yaml
- run: pnpm exec releasekit release --dry-run --json
```

`--dry-run` prints what would happen without modifying any files, creating tags, or publishing packages. `--json` emits structured output for inspection.
