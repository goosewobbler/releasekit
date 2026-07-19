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
  id-token: write       # for npm OIDC trusted publishing
  pull-requests: write  # only needed if you enable ci.prPreview.refreshAfterRelease (below)

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0

      - uses: pnpm/action-setup@v6

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

      # Optional: after the release moves `main`, refresh the "what would release" preview on still-open
      # PRs (they otherwise stay frozen at the pre-release baseline). No-op unless you enable
      # `ci.prPreview.refreshAfterRelease`. See "PR Preview Comments" below.
      - run: pnpm exec releasekit refresh-after-release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
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
| `release:graduate` | Graduate a prerelease to stable |
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
| _(no `bump:*` label — commit-driven)_ | `1.0.0-next.6` | `1.0.0-next.7` — increments the counter; the magnitude does **not** escalate the base, a fixed target until graduation (#500) |
| `bump:patch` | `1.0.0-next.6` | `1.0.0-next.7` — advances the prerelease counter (no graduation) |
| `bump:minor` | `1.0.0-next.6` | `1.1.0-next.0` — explicit magnitude: escalates the prerelease base (no graduation) |
| `bump:major` | `1.0.0-next.6` | `2.0.0-next.0` — explicit magnitude: escalates the prerelease base (no graduation) |
| `channel:prerelease` + `bump:patch` | `1.0.0` | `1.0.1-next.0` |
| `channel:prerelease` + `bump:minor` | `1.0.0` | `1.1.0-next.0` |
| `channel:prerelease` + `bump:major` | `1.0.0` | `2.0.0-next.0` |
| `channel:prerelease` + `bump:patch` | `1.0.0-next.6` | `1.0.1-next.0` — starts a fresh patch prerelease line |
| `channel:prerelease` + `bump:minor` | `1.0.0-next.6` | `1.1.0-next.0` — starts a fresh minor prerelease line |
| `channel:prerelease` + `bump:major` | `1.0.0-next.6` | `2.0.0-next.0` — starts a fresh major prerelease line |
| `channel:prerelease` alone | any | No release — add a `bump:*` label |
| `release:graduate` alone | `1.0.0-next.6` | `1.0.0` |
| `release:graduate` alone | `1.0.0` | No release — already at stable version |
| `release:graduate` + any `bump:*` | `1.0.0-next.6` | `1.0.0` — bump label is ignored during stable promotion |
| `release:graduate` + `bump:minor` | `1.0.0` | `1.1.0` — bump applies to already-stable packages |

> **Each package's channel is derived from its *current* version, and the default advances along it
> — a `-next` package never graduates to stable without an explicit `release:graduate`.** A standing
> PR with permanently-mixed maturity (mature stable packages alongside incubating `-next` ones) is
> normal: each package walks its own line, so the same merge can ship `10.2.0` (stable) and
> `1.1.0-next.0` (prerelease) at once. The commit-driven default on a prerelease just **increments
> the counter** (the base is a fixed target until graduation, #500). An explicit `bump:*` label is a
> deliberate magnitude declaration, so it's honoured — on a prerelease a `bump:minor`/`bump:major`
> **escalates the base** to a fresh line (above). Use `release:graduate` to promote, `channel:prerelease`
> to drag a stable package onto a prerelease line.

> **`channel:prerelease` + `bump:*` escalates — it starts a *fresh* prerelease line at the chosen
> magnitude, even when the package is already on a prerelease.** So `bump:major` + `channel:prerelease`
> on `1.1.1-next.1` yields `2.0.0-next.0`, not `1.1.1-next.2`. To *iterate* an existing prerelease
> counter (`2.0.0-next.0` → `2.0.0-next.1`), let the bump come from commits with **no** `bump:*`
> label — the commit-driven default advances the counter and leaves the base alone (#500). (An
> explicit `bump:*` label declares a magnitude and escalates the base instead.)

> **`channel:prerelease` is a channel modifier, never a standalone release trigger.** It does
> nothing without a `bump:*` label in label/direct mode (it can't pick a magnitude on its own), and
> in standing-pr mode it simply sets the channel for the next merge. Graduating a prerelease to its
> stable base version is a distinct, standalone action carried by the `release:graduate` *flow*
> label (`1.0.0-next.6` → `1.0.0`); it can stand alone in label/direct mode because graduation
> resolves to exactly one version, and on an already-stable package it's a no-op. In standing-pr
> mode the *merge* is the trigger, so `channel:prerelease` and `release:graduate` both act as
> modifiers on the next merge. (The `release:` namespace is deliberate — graduation is a release
> *decision*, not a channel selection.)

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    branches: [main]

permissions:
  contents: write
  id-token: write
  pull-requests: write  # `read` is enough for release alone; `write` is needed to refresh previews after release

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0

      - uses: pnpm/action-setup@v6

      - uses: actions/setup-node@v6
        with:
          node-version: '24'
          cache: pnpm
          registry-url: 'https://registry.npmjs.org'

      - run: pnpm install --frozen-lockfile

      - run: pnpm exec releasekit release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      # Optional: refresh open-PR previews against the post-release baseline.
      # No-op unless ci.prPreview.refreshAfterRelease is enabled.
      - run: pnpm exec releasekit refresh-after-release
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

      - uses: pnpm/action-setup@v6

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

### Keeping previews fresh after a release

A preview is computed on `pull_request` events. When a release moves `main`, GitHub does **not**
re-fire those events on other open PRs, so each one's prediction stays frozen at the *pre-release*
baseline until it's pushed again. Enable a post-release refresh to fix this:

```jsonc
{
  "ci": {
    "prPreview": { "enabled": true, "refreshAfterRelease": true }
  }
}
```

With `refreshAfterRelease` on, add a `refresh-after-release` step to your release job (see the
[Minimal](#minimal-setup-push-to-main) and [Label-Based](#label-based-trigger) examples). After each
release it replays the preview on still-open PRs that already have one — skipping drafts, the standing
PR, and PRs without a preview, and bounded to 50 PRs per run. It's best-effort: a per-PR failure only
warns. (`ci.prPreview: true` remains valid shorthand for `{ "enabled": true }`.)

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
| `authorization` | (unset) | Restrict who can steer the standing PR — selection checkboxes, release labels, and merge. See [Securing the standing PR](#securing-the-standing-pr). Omit for today's behavior (anyone with the GitHub permission GitHub itself requires for each action). |
| `primaryPackages` | `[]` | Render the selection checklist as **release units**: declare the driver packages (globs or exact names) and each shows as a parent row with its coupled group-mates and changed prerequisites nested beneath, so one toggle holds back the whole unit. Empty → flat per-package list. See **Ad-hoc package selection** below. |
| `selection` | `streamlined` | How units render when `primaryPackages` is set. `streamlined`: one checkbox per primary, coupled members read-only in a collapsed pane, a held-back primary cascades to its whole unit. `granular`: every package keeps its own checkbox nested under its primary, no cascade. Ignored when `primaryPackages` is empty. |

### Securing the standing PR

The standing PR is a **release-control surface**, not just a PR. Its release labels (`bump:*`, `scope:*`, `channel:*`, `release:with-prerequisites`) and selection checkboxes decide *what* publishes, and **merging it is the publish**. But GitHub maps all of that onto coarse repo roles: anyone with **Triage** can apply labels, anyone with **Write** can merge. GitHub itself can't express "Triage, but not release-steering," can't restrict labels per-label, can't hide the PR from some actors, and can't gate checkbox edits.

So control is enforced in two places:

- **Selection + release labels** — enforced *in code* by ReleaseKit, because GitHub can't. The manifest comment is authoritative; an unauthorized edit to the checkboxes or release labels is ignored and reconciled back to the manifest on the next update (the box re-ticks, the rogue label is removed, a notice is posted). This is opt-in hardening for teams that delegate triage.
- **Merge (= publish)** — enforced by a **GitHub branch ruleset** (the primary gate, since merge is the privileged action) plus a publish-time **author check** (`enforceMergeAuthor`, defense-in-depth behind the ruleset).

#### The `authorization` config

```json
{
  "ci": {
    "standingPr": {
      "authorization": {
        "requiredPermission": "admin",
        "allowedActors": ["release-bot", "@acme/releasers"],
        "enforceMergeAuthor": true
      }
    }
  }
}
```

| Field | Default | Purpose |
|---|---|---|
| `requiredPermission` | `admin` | Minimum repo permission to steer the standing PR. `admin` \| `maintain` \| `write`. |
| `allowedActors` | (unset) | Extra actors authorized regardless of permission: GitHub usernames, or `@org/team-slug` to authorize a whole team. |
| `enforceMergeAuthor` | `true` | Refuse to publish when the merger isn't authorized. Set `false` to rely on the branch ruleset alone. |

Omit `authorization` entirely and ReleaseKit behaves as it always has — anyone with the GitHub permission GitHub requires for each action can perform it.

#### Who can do what

With `authorization` configured (threshold `admin` shown):

| Action | GitHub requires | With `authorization` configured |
|---|---|---|
| Tick/untick a selection checkbox | Triage (edit PR body) | Honored only if the editor is authorized; otherwise reverted to the manifest, with a notice. |
| Add/remove a release label (`bump:*`, `scope:*`, `channel:*`, `release:with-prerequisites`) | Triage | Same — unauthorized changes are reverted and a notice posted. |
| Add/remove a non-release label (`area:*`, …) | Triage | Unaffected — ReleaseKit only reconciles release-control labels. |
| Merge the standing PR (**= publish**) | Write | Refused at publish if the merger isn't authorized (`enforceMergeAuthor`); the branch ruleset below is the primary gate. |

#### Branch rulesets (the merge gate)

The in-code gates keep the *manifest* clean, but the merge itself is a GitHub action — gate it with two **repository rulesets** (Settings → Rules → Rulesets). Create them once, by hand or via your IaC/Terraform; they're repo policy and want an admin to apply deliberately.

> **Rulesets require the right plan.** They're available on **public** repositories on any plan, and on **private** repositories only with **GitHub Pro / Team / Enterprise** — a private repo on Free has no rulesets at all. The **evaluate** (dry-run) enforcement mode mentioned below is **Enterprise-only**.

**1. Lock the release branch** — target `release/next` (your `ci.standingPr.branch`). Enable **Restrict creations**, **Restrict updates**, and **Restrict deletions** so only bypass actors can write the branch — no one can inject a commit that would then be published.

> ⚠️ The release bot pushes (and force-pushes) this branch, so it **must** be on the ruleset's *Bypass list* or releases break — ReleaseKit can't infer the bot's identity for you. **Add the bot as a bypass actor before the ruleset goes `active`.** On **GitHub Enterprise** you can instead create it in **evaluate** (dry-run) mode first and confirm in the repo's *rule insights* that the bot isn't tripped, then switch to active — but **evaluate mode is Enterprise-only**, so on every other plan add the bypass actor first and create the ruleset directly as `active`. (A bypass actor's force-push is not blocked by the lock, so the standing-PR refresh keeps working.)

**2. Require review on the default branch** — target `main` (or `~DEFAULT_BRANCH`). Enable **Require a pull request before merging** (≥ 1 approval), **Block force pushes**, and **Restrict deletions**. Since merging the standing PR is the publish, this gates the publish behind review.

**Mapping `allowedActors` to ruleset bypass actors:** a `@org/team-slug` entry maps to a **Team** bypass actor and a plain **username** maps to a **User** bypass actor — add either to the ruleset's *Bypass list*. (GitHub also exposes repository **roles** and **Apps**, which is how a bot running as a GitHub App or the Actions bot is exempted.) Always keep org/repo admins on the bypass list so you can't lock yourself out.

#### Token caveats

- **`@org/team` allow-lists** need a token with **`read:org`** scope — a PAT or GitHub App, **not** the default `GITHUB_TOKEN`. Without it, the team-membership check can't be answered, and the two gate types resolve it differently: the **selection and release-label gates fail _closed_** (the actor isn't treated as authorized; their edit is reverted, with a warning), while the **publish-author gate (`enforceMergeAuthor`) fails _open_** (it warns and proceeds, because the branch ruleset is the primary merge gate — a token misconfiguration shouldn't block a legitimate release). So **don't rely on `enforceMergeAuthor` alone for team-based merge control** — set up the branch ruleset. Username and permission-threshold entries work with the default token.
- **Creating rulesets** needs an **admin-scoped** token (or just do it in the GitHub UI as an admin).

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
  # Rapid checkbox toggles each fire a separate `edited` event — route a maintainer's edits to a
  # per-PR group that cancels in-progress runs, so a flurry of ticks collapses to one rebuild of the
  # latest selection. Everything else — push / schedule / merge, AND the bot's own body edits (the
  # processing banner + the rebuilt body, which are `edited` from a Bot sender) — stays on the stable
  # shared group with cancelling OFF, so a bot edit never cancels the run doing the work and a queued
  # publish dispatch is never dropped. The `sender.type != 'Bot'` guard is what keeps the two apart.
  group: ${{ (github.event_name == 'pull_request' && github.event.action == 'edited' && github.event.sender.type != 'Bot') && format('standing-release-pr-edit-{0}', github.event.pull_request.number) || 'standing-release-pr' }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' && github.event.action == 'edited' && github.event.sender.type != 'Bot' }}

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
      # Post an instant "updating…" banner so a maintainer who just ticked a checkbox (or changed a
      # label) knows the change was received while the slower rebuild runs. Reactive events only; runs
      # BEFORE checkout so it lands within seconds. `standing-pr update` regenerates the body from
      # scratch, so the banner self-clears on success; the failure step below strips it if the run dies
      # first. Idempotent — skips if a banner is already present.
      - name: Acknowledge the update in progress
        if: github.event_name == 'pull_request'
        env:
          GH_TOKEN: ${{ github.token }}
          REPO: ${{ github.repository }}
          PR: ${{ github.event.pull_request.number }}
          RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
        run: |
          set -euo pipefail
          BODY=$(gh api "repos/$REPO/pulls/$PR" --jq '.body // ""')
          case "$BODY" in
            *'<!-- releasekit-processing -->'*) echo "Banner already present — skipping"; exit 0 ;;
          esac
          BANNER=$'<!-- releasekit-processing -->\n> 🔄 **Updating the release PR** to reflect your change… ([run details]('"$RUN_URL"$'))\n<!-- releasekit-processing-end -->'
          NEWBODY=$(printf '%s\n\n%s' "$BANNER" "$BODY")
          gh api --method PATCH "repos/$REPO/pulls/$PR" -f body="$NEWBODY" >/dev/null

      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
          token: ${{ github.token }}

      - uses: pnpm/action-setup@v6

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

      # On success the regenerated body already omits the banner; only a run that ended before the
      # rebuild leaves it behind. Strip the marker region so it doesn't linger as a false "in progress".
      # `cancelled()` too — a manual cancel (or a superseded reactive run) also skips the rebuild.
      - name: Clear the in-progress banner if the update didn't finish
        if: (failure() || cancelled()) && github.event_name == 'pull_request'
        env:
          GH_TOKEN: ${{ github.token }}
          REPO: ${{ github.repository }}
          PR: ${{ github.event.pull_request.number }}
        run: |
          set -euo pipefail
          BODY=$(gh api "repos/$REPO/pulls/$PR" --jq '.body // ""')
          CLEANED=$(printf '%s' "$BODY" | sed '/<!-- releasekit-processing -->/,/<!-- releasekit-processing-end -->/d')
          gh api --method PATCH "repos/$REPO/pulls/$PR" -f body="$CLEANED" >/dev/null

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

      - uses: pnpm/action-setup@v6

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

      - uses: pnpm/action-setup@v6

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
2. **Merge → publish:** Maintainers merge the standing PR when ready. The `pull_request.closed` trigger fires `standing-pr publish`, which reads the release manifest from the bot's PR comment and publishes the packages. It does not re-run the version-bump computation, but it does **validate the manifest against the merged source** before publishing anything (see **Manifest integrity** below), so the publish reflects exactly what was reviewed and merged.
3. **Recurring re-evaluation:** The hourly `schedule` trigger re-runs `update`, which is essentially free when nothing has changed but advances the `minAge` countdown so the status check transitions from `pending` to `success` as time passes.

Use `release:graduate` and `channel:prerelease` labels on **the standing PR itself** to control release type during merge.

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

### Keeping CI off the standing PR

Every `standing-pr update` force-pushes the release branch (`release/next`), which is a `pull_request: synchronize` on the open standing PR. If your build/test CI triggers on `pull_request` (the usual `[opened, synchronize, reopened]`), **it re-runs the whole matrix on every update** — each feeder merge, and each checkbox toggle that changes the selection. On a large cross-platform matrix that's dozens of jobs per update, all wasted: the release branch only ever carries version bumps and regenerated changelogs on top of `main`, whose code was already validated on each feeder PR and is validated again on push to `main` when the standing PR merges.

Path or change-detection filters won't save you — a release commit touches version files and changelogs across **every** releasing package, so it reads as "everything changed" and fans the matrix out regardless.

`[skip ci]` is **not** the lever: the standing PR's single prep commit deliberately omits it. A squash-merge inherits that commit's message onto `main`, where `[skip ci]` would suppress the publish workflow — so the skip has to live in your CI's triggers, not the commit. Exempt the branch with a head-ref guard:

```yaml
# In your build/test workflow (e.g. ci.yml)
jobs:
  build:
    # Skip the standing PR — its branch only carries release bumps, already CI'd on the feeder PRs.
    if: ${{ !startsWith(github.head_ref, 'release/') }}
    # ...
```

`github.head_ref` is set only for `pull_request` events (it's empty on `push: main`), so your main-branch CI is unaffected. Apply the guard wherever it gates the rest of the run — a single change-detection / entry job that everything else `needs` is the cleanest single point; otherwise guard each job. There's no `on:`-level lever for this: `on.pull_request.branches` filters by the PR's **base** branch (the merge target, `main`), not its head, so a job-level `if` is the only way to target the release branch. (`release/` matches the default `ci.standingPr.branch` of `release/next`; adjust the prefix if you changed it.)

Skipping entirely is the recommended default — the merge to `main` re-runs CI anyway. If you want a cheap safety net on the release branch, keep a fast lint/typecheck job and guard only the heavy build/e2e legs.

### In-progress feedback

Ticking a checkbox or changing a label on the standing PR re-runs `standing-pr update`, which takes a minute or two (checkout → install → rebuild). To avoid a silent wait, the template posts an **in-progress banner** to the top of the PR body within seconds of the change:

> 🔄 **Updating the release PR** to reflect your change… ([run details](#))

Mechanics (all in `standing-pr.yml`, no config):

- **Fast.** The banner is a plain `gh api` step that runs *before* checkout/install, so it lands ~10–15s after the runner starts (the spin-up floor — an Actions job can't react instantly the way a native GitHub App can). It's on reactive events only; push/schedule updates aren't interactive.
- **Self-clearing.** `standing-pr update` regenerates the PR body from scratch, so a successful update drops the banner automatically. A dedicated `if: failure()` step strips it if the run dies before the rebuild, so it never lingers as a false "in progress".
- **Idempotent.** The step skips if a banner is already present, so rapid re-triggers don't stack it.

Rapid checkbox toggles are also **collapsed**: the workflow's `concurrency` routes a maintainer's `edited` events to a per-PR group with `cancel-in-progress: true`, so ticking several packages in a row cancels the superseded rebuilds and only the latest selection is applied. The group is sender-aware — the bot's *own* body edits (the banner and the rebuilt body are `edited` events too) stay on the stable non-cancelling group, so they never cancel the run doing the work; push/schedule/merge events stay there too (a cancelled publish dispatch could drop a release).

### Label semantics in standing-pr mode

Labels behave differently in standing-pr mode than in direct mode. There are two surfaces.

**1. Feeder PRs (PRs being merged into `main`)** — labels are **advisory**.

`bump:*`, `scope:*`, `release:graduate`, and `channel:prerelease` on a feeder PR are shown in the preview comment so reviewers know they were noticed, but they do **not** drive behavior on merge. Bumps for the standing PR come from conventional commits across the union of queued changes; scope is global (the standing PR aggregates everything).

**2. The standing PR itself** — labels are the **canonical override surface**.

A maintainer can edit labels directly on the standing PR (via the GitHub UI or `gh pr edit <n> --add-label bump:major`). Adding or removing a label re-runs `standing-pr update` immediately (the `pull_request` `labeled`/`unlabeled` trigger), so the recomputed version table and status check reflect the new labels within seconds — no waiting for the next push or the hourly cron. The update reads those labels and applies them as overrides:

| Label on standing PR | Effect |
|---|---|
| `bump:patch` / `bump:minor` / `bump:major` | Forces that bump magnitude, overriding what conventional commits would otherwise produce. |
| `scope:foo` (per `ci.scopeLabels`) | Limits the release to scoped packages on the next update. |
| `release:graduate` | Graduates **every** queued prerelease to its stable base version. |
| `graduate:<package>` | Graduates **just that** prerelease package (and, atomically, any `fixed`/`linked` group it belongs to) to stable on the next update — other prerelease packages keep advancing their line. The label is per-package (`graduate:@scope/core`); ReleaseKit seeds one for every package currently on a prerelease line so it appears in the GitHub label picker. Prefix configurable via `ci.labels.graduatePackagePrefix`. |
| `channel:prerelease` | Switches the standing PR to prerelease versioning. |

Conflicts (e.g. both `bump:patch` and `bump:major`) surface as a `pending` `releasekit/standing-pr` status check on the release branch and a workflow warning. The override is dropped (falls back to commit-driven) until the conflict is resolved by removing one of the labels.

The `standing-pr update` workflow **preserves maintainer-added labels across runs** — labels you add stick until you remove them.

**Ad-hoc package selection.** The standing PR body carries a **Packages to release** checklist — one ticked row per changed package. Untick a package to hold it back from the next release and save; the `edited` trigger re-runs `standing-pr update`, which excludes it from the version bump entirely (no orphan version lands on `main`) and records the held-back set in the manifest. The choice survives later pushes — a held-back package re-renders as an unticked row until you re-tick it. The package each row refers to is read from its `<!-- rk-sel:… -->` marker comment, so keep those intact. Unticking a member of an `independent` group, or a prerequisite still needed by a ticked target, surfaces a ⚠️ warning in the body; members of a lockstep (`fixed`/`linked`) group can't be held back individually and re-tick automatically. (Sync releases ship atomically and carry no checklist.) When a standing PR mixes maturities, the checklist splits into a **Stable** section (advancing on `latest`) and a **Prereleases** section (each row showing the pre-release dist-tag it advances on, e.g. `next`); a single-channel PR shows one flat list. Checkboxes are one of three release-coordination mechanisms — see the [release taxonomy](../../../docs/release-taxonomy.md) for how selection composes with groups and prerequisites.

**Private packages are never released.** Packages marked `"private": true` — test apps, examples, internal fixtures — are excluded from the release set automatically: they never appear in the selection checklist or the changelog, and need no `version.skip` entry. (Cargo `publish = false` and pub `publish_to: none` are skipped the same way.) Set [`version.includePrivate`](../../../docs/configuration.md#version) to `true` only if you deliberately version a private package for internal tracking.

**Release units (`primaryPackages`).** In a service-shaped monorepo you usually think *"release the tauri service and whatever ships with it,"* not package-by-package. Set [`ci.standingPr.primaryPackages`](../../../docs/configuration.md#cistandingpr) to the driver packages (globs or exact names) and the checklist renders **release units**: each primary becomes a parent row with its coupled group-mates and changed prerequisites nested beneath. In the default **`streamlined`** mode you toggle one checkbox per primary — its coupled members show as read-only bullets in a collapsed pane, and unticking the primary cascades to hold back the whole unit (a member shared by two primaries keeps releasing until *both* its owners are held). A primary still anchors its unit even when it isn't bumping — common under `linked` groups, where a plugin-only change still shows the service as the parent, marked `— no change`. Switch `selection` to **`granular`** to keep an individual checkbox on every package (nested under its primary, no cascade). A changed package that is neither a primary nor one of their coupled members still renders as its own top-level checkbox — units only collapse known hierarchies, never hide a package. Enabling `primaryPackages` on an existing standing PR re-seeds the checklist on the next run; a coupled member you'd held back is escalated to holding its whole unit, so nothing you held back slips out.

**Staleness guard.** The manifest records the override labels it was computed under. If the standing PR's labels are changed and it's merged before the triggered update re-runs (a narrow race), `standing-pr publish` detects that the merged PR's override labels no longer match the manifest and **refuses to publish** rather than shipping a release the labels no longer describe — re-run `standing-pr update` and merge again (or apply the retry label after updating). So a mismatched manifest can never be released, even though merge itself isn't blocked.

**Manifest integrity.** The manifest comment is the plan `standing-pr publish` acts on, and a repo write-access actor can edit a PR comment — so the publish never trusts it verbatim. Before creating any tag or touching any registry it: (1) **recomputes and compares** — reads each package's actual version from the merged commit (the reviewed-and-merged source of truth) and refuses if the manifest names a package the workspace doesn't have, a version that doesn't match the merged source, or a consumer tag that encodes no published version; (2) **schema-validates** the decoded manifest, requiring an exact known `schemaVersion` and rejecting a malformed or oversized payload; and (3) **author-binds** — requires the manifest comment to have been written by the bot/app identity, so a human-authored or pre-seeded comment carrying the marker is never adopted or trusted. Combined with the merge-author gate (`ci.standingPr.authorization`) and a branch-protection ruleset on the release branch, this closes the path where an insider edits the hidden manifest to smuggle an arbitrary `package@version` to a registry under the project's identity.

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
| Every standing-PR update re-runs my whole build matrix | Your CI triggers on `pull_request` and isn't exempting the release branch. Add a head-ref guard — see [Keeping CI off the standing PR](#keeping-ci-off-the-standing-pr). `[skip ci]` can't be used here (it would suppress publish on merge). |
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
| Promote **all** accumulated prereleases to stable | Add `release:graduate` to the standing PR and merge it. |
| Promote **one** prerelease package to stable (others stay prerelease) | Add `graduate:<package>` to the standing PR (e.g. `graduate:@scope/core`); others keep advancing their line. |
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
  - uses: pnpm/action-setup@v6

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

      - uses: pnpm/action-setup@v6

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
