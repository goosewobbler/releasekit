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
- PR label `release:stable` support in workflow templates for graduation from prerelease
- Posts/updates a single PR comment via `@octokit/rest` using HTML marker (`<!-- releasekit-preview -->`)
- Falls back to stdout when GitHub context unavailable
- `--dry-run` flag prints comment markdown to stdout without posting
- Template workflow: `templates/workflows/release-preview.yml`
- Self-hosted workflow: `.github/workflows/release-preview.yml`

### Push-Triggered Release Workflow (Feature 1)
- `.github/workflows/release.yml` implements automated releases on main push
- Uses `workflow_run` trigger to run after CI passes
- Detects release labels on merged PRs (`bump:patch`, `bump:minor`, `bump:major`, `release:prerelease`, `release:stable`)
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

---

## Planned Features

### Standing PR Follow-ups

These build on the core standing PR feature. Prioritised before Scheduled Releases since they complete the standing-PR workflow surface.

#### Follow-up 1 — `standing-pr merge` subcommand

**Problem.** After reviewing a standing PR, a maintainer may want to trigger the merge (and optionally the publish) from the CLI or an ad-hoc CI job, rather than clicking merge in the GitHub UI. This is also useful for chaining into custom automation.

**Solution sketch.** A new `releasekit standing-pr merge [--publish]` subcommand that:

1. Locates the currently open standing PR via `findStandingPR()` (`packages/release/src/standing-pr.ts:230`).
2. Calls `octokit.rest.pulls.merge()` with `merge_method` from `ci.standingPr.mergeMethod`.
3. If `--publish` is set, invokes a new `publishFromManifest(prNumber, options)` core function that performs the same work `runStandingPRPublish` does today, minus the `GITHUB_EVENT_PATH` parsing.

Refactor `runStandingPRPublish` (`standing-pr.ts:425`) into:
- `publishFromManifest(prNumber, options)` — the core: find manifest comment → parse → call `runPublishStep` with `skipGitCommit: true` → delete branch.
- `runStandingPRPublish(options)` — thin wrapper that reads the event payload, validates the merged PR, then calls `publishFromManifest`.

`standing-pr merge --publish` calls `publishFromManifest` directly with the PR number returned by the merge API.

**Config changes.** None. `mergeMethod` already exists on `StandingPrConfigSchema` (`packages/config/src/schema.ts:272`).

**Implementation.**
- `packages/release/src/standing-pr.ts` — factor out `publishFromManifest`; add `runStandingPRMerge(options, { publish: boolean })`.
- `packages/release/src/standing-pr-command.ts` — register a third subcommand `merge` with a `--publish` flag.
- `packages/release/src/index.ts` — export `runStandingPRMerge`.
- Branch-protection handling: if `pulls.merge` returns 405 (blocked), catch and surface a clear error listing the blocked reason from the response body. Do not attempt to bypass.

**Testing.**
- `standing-pr.spec.ts` — new tests: `runStandingPRMerge` calls `pulls.merge` with configured `merge_method`; returns error when no open PR; surfaces 405 blocked with actionable message; when `publish: true` invokes `publishFromManifest` with the merged PR number.
- `standing-pr-command.spec.ts` — `merge` subcommand wired up, `--publish` flag threaded through.

**Decisions.**
- `--publish` runs inline in the same process (not a separate job) so a maintainer can do merge+publish from their laptop if npm tokens and GitHub context are present in env. The standard workflow template still performs publish in a separate job driven by the merged-PR event; `--publish` is for the CLI flow specifically.
- We do not add a `--force` flag to bypass branch protection — protections exist for a reason and the GitHub API will enforce them regardless.

---

#### Follow-up 2 — Release notes editing in PR

**Problem.** Generated release notes are mechanical. Teams often want to add context, reorder highlights, or soften phrasing before publishing. Currently the only way is to regenerate changelogs manually and push a new commit.

**Solution sketch.** Render the notes section inside an editable block on the standing PR body:

```markdown
<!-- releasekit-editable-start -->
### Release Notes

#### @scope/core — 1.2.3
- added new feature

#### @scope/cli — 2.0.0
- fixed bug
<!-- releasekit-editable-end -->
```

On every `standing-pr update` run, the block is **only re-rendered if the current PR body's editable section matches the previously generated content byte-for-byte** (tracked via a hash stored in the manifest). If the user edited it, we preserve their edits and re-render only the non-editable parts (title, package table, footer).

On publish, `publishFromManifest` re-fetches the PR body, extracts the editable section, parses per-package notes back into a `Record<string, string>` by splitting on `#### ` headings, and replaces `manifest.releaseNotes` before calling `runPublishStep`. Publish notes flow into `ctx.releaseNotes` → `findNotesForTag()` (`packages/publish/src/stages/github-release.ts:125`) → `gh release create --notes <body>`.

**Config changes.** Add `ci.standingPr.editableNotes: boolean` (default `false`) to `StandingPrConfigSchema`. Mirror in `releasekit.schema.json`. Opt-in preserves current behaviour for existing users.

**Implementation.**
- `packages/release/src/standing-pr.ts`:
  - Update `renderPrBody` to wrap the notes section in `<!-- releasekit-editable-start -->` / `<!-- releasekit-editable-end -->` markers when `editableNotes` is enabled.
  - Add `extractEditableSection(body)` and `parseEditedNotes(section)` helpers. The parser splits on `#### <pkg> — <version>` boundaries, matching the same shape `renderPrBody` emits.
  - Add `notesHash` to `StandingPRManifest` (the hash of the generated editable section at last update). When updating a PR, compute the current body's editable section hash; if it matches the manifest's `notesHash`, regenerate (user hasn't edited); otherwise preserve the user's edits.
  - In `publishFromManifest`, after parsing the manifest: if `editableNotes` enabled, fetch PR body via `octokit.rest.pulls.get`, extract the editable section, parse it, and replace `manifest.releaseNotes` before calling `runPublishStep`.
- `packages/config/src/schema.ts` / `releasekit.schema.json` — add the flag.

**Testing.**
- `standing-pr.spec.ts`:
  - `renderPrBody` emits editable markers when enabled, omits when disabled.
  - `extractEditableSection` + `parseEditedNotes` round-trip the rendered body.
  - Unedited body → regenerated on next update (matches hash).
  - Edited body → preserved on next update (hash mismatch).
  - `publishFromManifest` with edited notes — edited content replaces manifest notes and flows to `runPublishStep`.

**Decisions.**
- Hash-based edit detection rather than diffing: small, cheap, robust to whitespace edits.
- We parse user markdown loosely — if a package heading goes missing, fall back to the manifest's note for that package (don't fail the publish). Warn about the missing heading.
- Disabled by default — editing a PR body is a power-user feature and existing users should not see marker noise appear in their PRs after a version bump.

---

#### Follow-up 3 — Standing PR status checks

**Problem.** Reviewers need signals beyond "tests pass" — specifically: is the PR still up-to-date with main, and (once follow-up 4 lands) has the minimum accumulation window elapsed?

**Solution sketch.** Use `octokit.rest.repos.createCommitStatus()` to post a status on the release branch HEAD after every update. Single context: `releasekit/standing-pr`. States:

- `success` — manifest is fresh AND (if follow-up 4 gates are configured) gates satisfied
- `pending` — one or more accumulation gates not yet satisfied (only when follow-up 4 config is set)
- `failure` — manifest SHA diverges from current main HEAD (edge case: main received a commit between the push event firing and the update completing)

The description text tells the reviewer what's blocking: "Ready to merge", "Waiting 2h 15m for minAge", "Needs 3 more packages", "Stale — re-run standing-pr update".

This integrates with repo-level required-status-check branch protection: maintainers configure `releasekit/standing-pr` as a required check, and GitHub enforces the gate at merge time.

**Config changes.** None in this follow-up directly — the check is posted unconditionally at the end of `runStandingPRUpdate`. The states driven by accumulation controls come in follow-up 4.

**Implementation.**
- `packages/release/src/standing-pr-status.ts` (new module) — `postStandingPRStatus(octokit, owner, repo, sha, state, description)` wrapping `repos.createCommitStatus`.
- `packages/release/src/standing-pr.ts` — at the end of `runStandingPRUpdate`, after the PR is created/updated, call `postStandingPRStatus` on the release branch HEAD SHA (captured after the push).
- No new config needed; the check is always posted when a standing PR exists.

**Testing.**
- New unit tests in `standing-pr.spec.ts`:
  - Status posted on successful update with `state: success` and description "Ready to merge".
  - Status post failure is caught and logged (does not fail the update).

**Decisions.**
- Use the Commit Status API (`createCommitStatus`), not the Checks API. Simpler, no need for GitHub App authentication; works with the standard `GITHUB_TOKEN`. Check Runs would let us render more detail in the PR checks tab, but the extra plumbing is not worth it until someone asks for it.
- A single context string (`releasekit/standing-pr`). Multiple contexts would let us split freshness from accumulation-readiness, but branch protection rules list each context individually — one context keeps the setup instructions short.

---

#### Follow-up 4 — Batch release accumulation controls

**Problem.** With the standing PR strategy, every merged feature PR immediately updates the release PR and makes it mergeable. Some teams want to batch — "don't let me merge this PR until at least 6 hours have passed since it opened" or "don't create a release PR for fewer than 3 package changes".

**Solution sketch.** Two config options on `ci.standingPr`:

- `minAge` — duration string (`"6h"`, `"30m"`, `"1d"`) parsed with a small duration parser. Time baseline is the manifest's `firstUpdatedAt` field (added in this follow-up, not reset on subsequent updates — so it reflects "PR age").
- `minPackages` — integer; minimum distinct packages that must have changes before the standing PR is created. If the count is below the threshold, `standing-pr update` emits `action: 'noop'` and (if an open PR exists) closes it with a comment explaining the gate.

Gates are enforced via the status check from follow-up 3. When gates are not satisfied, the check reports `pending` with a human-readable description. Merge blocking requires the user to configure `releasekit/standing-pr` as a required status check in branch protection — the CLI does not attempt to enforce merge blocking itself.

Because GitHub status checks are static until re-posted, accumulation windows don't "advance" without an update. The workflow template should add a `schedule` trigger (default: hourly) that re-runs `standing-pr update` so the status transitions from `pending` → `success` as time passes. The update itself is cheap — dry-run version analysis + a status POST when nothing has changed.

**Config changes.** Extend `StandingPrConfigSchema` in `packages/config/src/schema.ts`:

```typescript
minAge: z.string().optional(),       // e.g. "6h", "30m", "1d"
minPackages: z.number().int().positive().optional(),
```

Mirror in `releasekit.schema.json`.

Add `firstUpdatedAt: string` to `StandingPRManifest` (`standing-pr.ts:29`). On create, set to `new Date().toISOString()`. On update, preserve the existing value from the prior manifest. Manifest `schemaVersion` bumps from `1` to `2`; `parseManifest` must accept both (treat missing `firstUpdatedAt` as "unknown" — status reports `success` for age in that case, as if the gate is satisfied).

**Implementation.**
- `packages/release/src/duration.ts` (new) — `parseDuration(str): number | null` (returns ms). Accepts `\d+(s|m|h|d)` — keep it minimal.
- `packages/release/src/standing-pr.ts`:
  - Preserve `firstUpdatedAt` across updates (find the existing manifest first; reuse its timestamp if present).
  - In `minPackages` check: if below threshold → noop path, close any open PR with a comment.
  - In `runStandingPRUpdate`'s status posting (from follow-up 3): compute whether gates are met, pick state + description accordingly.
- `packages/config/src/schema.ts` — add fields.
- `templates/workflows/standing-pr.yml` — add `schedule: - cron: '0 * * * *'` trigger. Update the job so the scheduled run posts an updated status check (essentially re-runs `standing-pr update`).

**Testing.**
- `duration.spec.ts` — parse each unit, reject invalid input.
- `standing-pr.spec.ts`:
  - `firstUpdatedAt` preserved across updates (new test uses a manifest with a past timestamp).
  - Below `minPackages` → noop + close existing PR.
  - Status check reports `pending` with age countdown when `minAge` not satisfied.
  - Status check reports `success` when both gates satisfied.
  - Backward compat: parsing a v1 manifest (no `firstUpdatedAt`) doesn't throw.

**Decisions.**
- Schema version bumps to `2`. `parseManifest` accepts both v1 and v2. (When eventually retired, bump to fail loudly on v1.)
- Gates enforced only via status check (not as hard blocks in the CLI). Repo owners opt in via branch protection. This matches the pattern of other CI gates.
- Hourly cron trigger is a sensible default for re-evaluating status; documented as adjustable.
- `minAge` baseline is "time since the PR was first opened", not "time since last update". Otherwise every push resets the clock, defeating the point of accumulation.

---

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
| `standing-pr merge` subcommand | Low | Medium | Planned |
| Release notes editing in PR | Medium | Low | Planned |
| Standing PR status checks | Low | Low | Planned |
| Batch accumulation controls | Medium | Low | Planned |
| Scheduled releases | Medium | Medium | Planned |
