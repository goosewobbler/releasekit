# ReleaseKit Automation Roadmap

Future features to enable fully automated release workflows (e.g. commits to main trigger releases).

## Completed

### Unified `releasekit release` CLI
- `@releasekit/release` package at `packages/release/`
- Orchestrates `version → notes → publish` programmatically in a single command
- Skippable steps: `--skip-notes`, `--skip-publish`, `--skip-git`, `--skip-github-release`
- Early exit with code 0 when no releasable changes (CI-friendly)
- Binary: `releasekit` / `releasekit release`

### Config-Driven CI Automation (Feature 5)
- `ci` section added to `releasekit.config.json` schema (`@releasekit/config`)
- `releaseStrategy`: `direct` (default) | `manual` | `standing-pr` | `scheduled`
- `prPreview`: enable/disable PR preview comments (default: `true`)
- `autoRelease`, `skipPatterns`, `minChanges` fields for future use
- `loadCIConfig()` loader function exported from `@releasekit/config`

### Release Preview on PRs (Feature 3)
- `releasekit preview` CLI command in `@releasekit/release`
- Runs `releasekit release --dry-run` and formats a markdown PR comment
- Strategy-aware messaging: intro and no-changes messages adapt to configured `releaseStrategy`
- Auto-detects prerelease versions from package.json files; defaults to prerelease preview
- `--prerelease [identifier]` and `--stable` CLI flags for manual override
- PR label `channel:stable` support in workflow templates for graduation from prerelease
- Posts/updates a single PR comment via `@octokit/rest` using HTML marker (`<!-- releasekit-preview -->`)
- Falls back to stdout when GitHub context unavailable
- `--dry-run` flag prints comment markdown to stdout without posting
- Template workflow: `templates/workflows/release-preview.yml`
- Self-hosted workflow: `.github/workflows/release-preview.yml`

### Push-Triggered Release Workflow (Feature 1)
- `.github/workflows/release.yml` implements automated releases on main push
- Uses `workflow_run` trigger to run after CI passes
- Detects release labels on merged PRs (`bump:patch`, `bump:minor`, `bump:major`, `channel:prerelease`, `channel:stable`)
- Automatically determines bump type from label
- Calls `_release.reusable.yml` reusable workflow for actual release
- Manual trigger also available via `workflow_dispatch`
- Release commits include `[skip ci]` to prevent infinite loops

### Standing Release PR (Feature 4)
- `releasekit standing-pr update` / `releasekit standing-pr publish` CLI subcommands in `@releasekit/release`
- Bot-maintained `release/next` branch: force-reset to base on each push, version bumps and changelogs committed
- Manifest stored as a bot comment (`<!-- releasekit-manifest -->`) on the standing PR — survives from `update` to `publish`
- `standing-pr update`: skip-pattern guard → dry-run version analysis → branch reset → write bumps + notes → force-push → create/update PR → write manifest
- `standing-pr publish`: reads merged PR event from `GITHUB_EVENT_PATH` → finds manifest → publishes with `skipGitCommit: true` → cleans up branch
- Idempotent publish: existing git tags and GitHub releases are skipped on retry
- Preview comments on feature PRs link to the existing standing PR when `releaseStrategy: 'standing-pr'`
- `ci.standingPr` config block: `branch`, `title`, `labels`, `deleteBranchOnMerge`, `mergeMethod`
- GitHub Action: `standing-pr-update` and `standing-pr-publish` modes with outputs `standing-pr-action`, `standing-pr-number`, `standing-pr-url`
- Workflow template: `templates/workflows/standing-pr.yml`

### Standing PR Follow-ups

The four follow-ups originally listed under Planned have all shipped. Design notes preserved below as a record of what was built.

#### Follow-up 1 — `standing-pr merge` subcommand (shipped, PR #157)

**Problem.** After reviewing a standing PR, a maintainer may want to trigger the merge (and optionally the publish) from the CLI or an ad-hoc CI job, rather than clicking merge in the GitHub UI. This is also useful for chaining into custom automation.

**Shipped.** `releasekit standing-pr merge [--publish]` is registered in `packages/release/src/commands/standing-pr-command.ts` and exposed via `runStandingPRMerge` in `packages/release/src/standing-pr/standing-pr.ts`.

- Locates the open standing PR via `findStandingPR()`.
- Calls `octokit.rest.pulls.merge()` with `merge_method` from `ci.standingPr.mergeMethod`.
- With `--publish`, calls `publishFromManifest(prNumber, options)` — the same core function `runStandingPRPublish` uses, factored out so the merge flow can call it directly.
- Branch-protection handling: 405 from `pulls.merge` is caught and surfaced with the blocked reason from the response body. No `--force` flag — protections are respected.

`mergeMethod` already existed on `StandingPrConfigSchema`, so no schema changes were required.

**Decisions (preserved).**
- `--publish` runs inline in the same process so a maintainer can do merge+publish from their laptop if npm tokens and GitHub context are present in env. The standard workflow template still performs publish in a separate job driven by the merged-PR event; `--publish` is for the CLI flow specifically.
- No `--force` flag — protections are enforced by the GitHub API regardless.

---

#### Follow-up 2 — Release notes editing in PR (shipped)

**Problem.** Generated release notes are mechanical. Teams often want to add context, reorder highlights, or soften phrasing before publishing. Previously the only way was to regenerate changelogs manually and push a new commit.

**Shipped.** `ci.standingPr.editableNotes: boolean` (default `false`) gates the feature. When enabled, `renderPrBody` wraps the notes section in `<!-- releasekit-editable-start -->` / `<!-- releasekit-editable-end -->` markers (`packages/release/src/standing-pr/standing-pr.ts`). Edit detection works via SHA hash:

- The manifest stores `notesHash` — the hash of the generated editable section at last update.
- On the next update, the current PR body's editable section is hashed and compared. If the user edited the section (hash differs), the user's edits are preserved; otherwise the section is regenerated.
- Helpers: `extractEditableSection(body)` and `parseEditedNotes(section)` round-trip the rendered shape (`#### <pkg> — <version>` boundaries).
- On publish, `publishFromManifest` re-fetches the PR body, extracts and parses the editable section, and replaces `manifest.releaseNotes` before calling `runPublishStep`. The edited notes flow into `ctx.releaseNotes` → `findNotesForTag()` → `gh release create --notes <body>`.

**Decisions (preserved).**
- Hash-based edit detection rather than diffing: small, cheap, robust to whitespace edits.
- Loose markdown parsing — if a package heading goes missing, fall back to the manifest's note for that package and warn rather than fail the publish.
- Disabled by default — editing a PR body is a power-user feature and existing users should not see marker noise appear in their PRs after a version bump.

---

#### Follow-up 3 — Standing PR status checks (shipped)

**Problem.** Reviewers need signals beyond "tests pass" — specifically: is the PR still up-to-date with main, and (with follow-up 4) has the minimum accumulation window elapsed?

**Shipped.** `packages/release/src/standing-pr/status.ts` exports `postStandingPRStatusSafe(octokit, owner, repo, sha, state, description)` wrapping `repos.createCommitStatus`. It is called at the end of `runStandingPRUpdate` on the release branch HEAD SHA captured after the push. Single context: `releasekit/standing-pr`. States:

- `success` — manifest is fresh AND any configured gates are satisfied
- `pending` — one or more accumulation gates not yet satisfied (typically `minAge`)
- `failure` — manifest SHA diverges from current main HEAD (rare; can occur if main receives a commit between the push event firing and the update completing)

The description text tells the reviewer what's blocking: "Ready to merge", "Waiting 2h 15m for minAge", etc. Maintainers configure `releasekit/standing-pr` as a required check in branch protection to enforce gates at merge time.

**Decisions (preserved).**
- Commit Status API (not Checks API). Simpler, works with the standard `GITHUB_TOKEN`, no GitHub App auth required. Check Runs would let us render more detail in the PR checks tab, but the extra plumbing is not worth it until someone asks for it.
- A single context string. Multiple contexts would let us split freshness from accumulation-readiness, but branch protection rules list each context individually — one context keeps the setup instructions short.

---

#### Follow-up 4 — Batch release accumulation controls (shipped)

**Problem.** With the standing PR strategy, every merged feature PR immediately updates the release PR and makes it mergeable. Some teams want to batch — "don't let me merge this PR until at least 6 hours have passed since it opened" or "don't create a release PR for fewer than 3 package changes".

**Shipped.** Two config options on `ci.standingPr`:

- `minAge` — duration string (`"6h"`, `"30m"`, `"1d"`) parsed by `parseDuration` in `packages/release/src/duration.ts`. Time baseline is the manifest's `firstUpdatedAt` field, set on first creation and preserved across updates so it reflects "PR age" rather than "time since last update".
- `minPackages` — integer; minimum distinct packages with releasable changes before the standing PR is created. Below threshold, `standing-pr update` emits `action: 'noop'` and (if an open PR exists) closes it with a comment explaining the gate.

Gates are reported through the status check from follow-up 3 — the CLI does not enforce merge blocking itself; that's the job of branch protection. The hourly `schedule` trigger on the workflow template re-runs `standing-pr update` so the status transitions from `pending` → `success` as time passes (the update is essentially free when nothing has changed).

Manifest `schemaVersion` bumped from `1` to `2` to add `firstUpdatedAt`. `parseManifest` accepts both versions; v1 manifests are treated as if the age gate is satisfied.

**Decisions (preserved).**
- Schema version bumps to `2`. `parseManifest` accepts both v1 and v2.
- Gates enforced only via status check (not as hard blocks in the CLI). Repo owners opt in via branch protection.
- Hourly cron trigger is a sensible default for re-evaluating status; documented as adjustable.
- `minAge` baseline is "time since the PR was first opened", not "time since last update". Otherwise every push resets the clock, defeating the point of accumulation.

---

## Planned Features

### Scheduled Releases

> **TODO:** Config schema supports `releaseStrategy: 'scheduled'` and preview messaging is in place.
> What remains: the actual cron-triggered workflow logic and any CLI support for scheduled release batching.

**Goal:** Releases are triggered on a schedule (e.g. weekly) rather than on every push or PR merge.

**What to build:**
- Workflow template with `schedule` (cron) trigger
- Collects all unreleased changes since last tag
- Runs `releasekit release` if there are releasable changes
- Preview comments on PRs indicate changes will be included in the "next scheduled release"

**Considerations:**
- Need to decide if scheduled releases can be combined with other strategies
- Should support configurable cron expression
- May need a "release window" concept where PRs merged during the window are batched

---

## Implementation Priority

| Feature | Effort | Impact | Status |
|---------|--------|--------|--------|
| Config-driven automation (5) | Low | Medium | Done |
| Release preview on PRs (3) | Medium | Medium | Done |
| Push-triggered workflow (1) | Low | High | Done |
| GitHub Action (1) | Medium | High | Done |
| Standing release PR (4) | High | Medium | Done |
| `standing-pr merge` subcommand | Low | Medium | Done |
| Release notes editing in PR | Medium | Low | Done |
| Standing PR status checks | Low | Low | Done |
| Batch accumulation controls | Medium | Low | Done |
| Scheduled releases | Medium | Medium | Planned |
