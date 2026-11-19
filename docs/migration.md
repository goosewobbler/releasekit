# Migrating to ReleaseKit

This guide helps teams move from semantic-release or changesets to ReleaseKit. Both migrations
follow the same broad pattern: install, create a config, swap the workflow step, dry-run, then
remove the old tool.

---

## At a glance

| If you want... | semantic-release | changesets | releasekit |
|---|---|---|---|
| Convention-driven bumps from commits | yes | partial (via plugins) | yes |
| Per-PR explicit bump intent (changeset files) | no | yes | partial (label-driven) |
| Standing release PR you can review before publish | no | yes | yes |
| LLM-enhanced release notes | no | no | yes |
| Rust/Cargo support | no | no | yes |
| Mixed npm + cargo monorepo | no | no | yes |
| Zero-install PR previews via GitHub Action | no | no | yes |

---

## Migrating from semantic-release

### Concept mapping

| semantic-release concept | releasekit equivalent |
|---|---|
| `release.config.js` plugins array | Built-in stages; `releasekit.config.json` sections |
| `@semantic-release/commit-analyzer` | Built-in (conventional commits, configurable preset) |
| `@semantic-release/release-notes-generator` | `@releasekit/notes` stage |
| `@semantic-release/npm` | `publish.npm` config |
| `@semantic-release/github` | `publish.githubRelease` config |
| `branches` config | Release branch via `git.branch`; prerelease channels via the `channel:prerelease` label |
| `SEMANTIC_RELEASE_PACKAGE` env var | `--target` flag or `version.packages` config |
| `.releaserc` / `release.config.js` | `releasekit.config.json` |

There is no plugin system to reason about. Each stage (version, notes, publish) is built in and
enabled or disabled via config keys. You gain Rust/Cargo support, LLM-enhanced notes, and a
first-class monorepo model without installing additional packages.

### Migration steps

1. **Install ReleaseKit.**

   ```bash
   npm install -g @releasekit/release
   # or
   pnpm add -g @releasekit/release
   ```

2. **Scaffold a config.** Run `releasekit init` to generate `releasekit.config.json` in your
   project root, then port your semantic-release options into it. The init command detects
   monorepo layouts automatically.

3. **Note the key differences from semantic-release:**
   - No plugin packages to install — all behaviour is configured in `releasekit.config.json`.
   - npm provenance is on by default.
   - OIDC is the default npm auth method in CI; no `NPM_TOKEN` secret is required when you
     use trusted publishing. See [CI setup](../packages/release/docs/ci-setup.md) for details.
   - The commit preset defaults to `conventionalcommits`. It sets how commits bump the version,
     not how the changelog groups them. If you were using `angular` in
     `@semantic-release/commit-analyzer`, `"version": { "preset": "angular" }` is the closest
     match. Unlike semantic-release's angular preset, it treats a `type!:` header and a
     `BREAKING-CHANGE:` footer as breaking, and releases at least a patch for every commit,
     `chore:` and `docs:` included.

4. **Replace the workflow step.** Remove the semantic-release step from your GitHub Actions
   workflow and add `releasekit release` in its place. A minimal replacement:

   ```yaml
   - run: pnpm exec releasekit release
     env:
       GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
   ```

   [`examples/`](../examples/README.md) has complete workflows, including OIDC publishing
   and label-based triggers.

5. **Dry-run before committing.**

   ```bash
   releasekit release --dry-run
   ```

   This runs the full pipeline — version analysis, changelog generation, publish simulation —
   without writing files, creating tags, or publishing packages.

6. **Remove semantic-release** once you have a clean release cycle through ReleaseKit.

### Config example

A common semantic-release setup and its `releasekit.config.json` equivalent:

```json
{
  "$schema": "https://goosewobbler.github.io/releasekit/schema.json",
  "version": {
    "preset": "angular",
    "packages": ["./"]
  },
  "notes": {
    "changelog": { "mode": "root" }
  },
  "publish": {
    "npm": { "enabled": true },
    "githubRelease": { "enabled": true }
  }
}
```

For a monorepo, change `changelog.mode` to `"packages"` and list your packages in
`version.packages`. See the [configuration reference](./configuration.md) for all available keys.

---

## Migrating from changesets

### Concept mapping

| changesets concept | releasekit equivalent |
|---|---|
| `.changeset/*.md` files | Conventional commits across feeder PRs (default) |
| `pnpm changeset` (create changeset) | Write conventional commit messages (`feat:`, `fix:`); the standing PR's bump is computed from the union of commits |
| Override the bump on the upcoming release | Add `bump:major` (or other) **on the standing PR itself** |
| `pnpm changeset version` | `releasekit standing-pr update` (runs automatically) |
| "Version Packages" PR | Standing release PR (`ci.releaseStrategy: "standing-pr"`) |
| `pnpm changeset publish` | Merge the standing PR (publish runs automatically) |
| Ship one PR urgently without queueing | Add `release:immediate` to the feeder PR |
| Retry a publish that failed partway | Add `release:retry` to the merged standing PR |
| `.changeset/config.json` | `releasekit.config.json` |
| `fixed` packages (move together) | `version.sync: true` |
| `linked` packages | Not directly supported; use `version.sync` |
| `ignore` packages | `version.skip` array |

The main conceptual shift is that bump intent moves from committed markdown files to **the
standing PR itself**. Conventional commits across feeder PRs are aggregated into the standing
PR's bump; if you need to override the magnitude (e.g. escalate from minor to major), add a
`bump:*` label directly to the standing release PR. Feeder-PR labels are advisory only —
they're shown in the preview but don't drive behavior. This keeps your repository history
clean (no `.changeset/` files), avoids merge conflicts on changesets in active monorepos, and
gives you one canonical place to see and adjust what's about to release.

### Why the standing-PR strategy feels most familiar

Changesets users are used to reviewing a "Version Packages" PR before publishing. The
`standing-pr` strategy is the direct analogue: ReleaseKit maintains a PR that accumulates
releasable changes, shows what will be released, and publishes when you merge it.

Optional guardrails mirror changesets' workflow:

- `ci.standingPr.minAge` — hold the PR open for a minimum duration (e.g. `"6h"`) before the
  status check turns green, giving the team time to review.
- `ci.standingPr.minPackages` — require at least N packages with releasable changes before a
  PR is created.

### Migration steps

1. **Install ReleaseKit.**

   ```bash
   npm install -g @releasekit/release
   # or
   pnpm add -g @releasekit/release
   ```

2. **Create `releasekit.config.json`** with the standing-PR strategy:

   ```json
   {
     "$schema": "https://goosewobbler.github.io/releasekit/schema.json",
     "ci": {
       "releaseStrategy": "standing-pr"
     },
     "publish": {
       "npm": { "enabled": true }
     }
   }
   ```

3. **Pick a release trigger** (in standing-pr mode, this only affects the
   `release:immediate` bypass path — see step 6; the standing PR itself is always
   commit-driven regardless of trigger).
   - `"releaseTrigger": "commit"` — for the immediate-release path, every merged PR with
     `release:immediate` ships using conventional commits to determine the bump.
   - `"releaseTrigger": "label"` — for the immediate-release path, the merged PR must
     also carry `bump:patch/minor/major` to specify the magnitude.

4. **Add the standing-PR workflow.** Copy
   [`examples/ci/standing-pr/standing-pr.yml`](../examples/ci/standing-pr/standing-pr.yml)
   into `.github/workflows/`. See
   [CI setup](../packages/release/docs/ci-setup.md#standing-release-pr) for required
   secrets and lifecycle details.

5. **Enable Actions write access.** Go to your repository Settings > Actions > General and
   enable "Allow GitHub Actions to create and approve pull requests". This is required for
   the bot to manage the release PR. It also lets workflow tokens approve pull requests: see
   [Workflow token approvals](../packages/release/docs/ci-setup.md#workflow-token-approvals).

6. **Remove changeset files.** Delete `.changeset/*.md` and `.changeset/config.json`.
   Existing changelog text should be retained — see the stumbling blocks section below.

7. **Dry-run the update.**

   ```bash
   releasekit release --dry-run
   ```

---

## Coexistence and phased migration

You can run ReleaseKit alongside the old tool for a few releases before fully switching over:

- Use `version.tagTemplate` to give ReleaseKit a distinct tag prefix, preventing it from
  picking up tags created by semantic-release or changesets during the overlap period.
- In a monorepo, use `--target` to point ReleaseKit at a subset of packages while the old
  tool continues to manage the rest.

Remove the old tool only after at least one clean release cycle has completed through
ReleaseKit.

---

## Common stumbling blocks

**"My CHANGELOG.md format looks different."**
ReleaseKit uses a template-based renderer (Handlebars/Liquid/EJS). Refer to the
`@releasekit/notes` configuration docs for template customisation options. The default format
follows Keep a Changelog conventions.

**"Tags now have a prefix I did not have before."**
Set `version.versionPrefix: ""` to strip the `v` prefix, or `"v"` to make it explicit. Use
`version.tagTemplate` for a fully custom format (e.g. `${packageName}/${prefix}${version}` for
monorepos).

**"I lost my changeset / semantic-release history."**
Copy your existing `CHANGELOG.md` content into the file before the first ReleaseKit run.
Subsequent releases prepend new entries; existing content is left intact.

**"My prerelease workflow is broken."**
ReleaseKit uses the `--prerelease <id>` CLI flag or the `channel:prerelease` PR label combined
with a `bump:*` label. See [CI setup](../packages/release/docs/ci-setup.md) for the label
combination table and prerelease workflow examples.

**"Nothing is being released."**
Check that your commits follow [Conventional Commits](https://www.conventionalcommits.org/)
format. If you are using label-based triggers, confirm the merged PR has a `bump:patch`,
`bump:minor`, or `bump:major` label. Run `releasekit release --dry-run --verbose` for
diagnostic output.

---

## Upgrading ReleaseKit

### `CHANGELOG.md` is LLM-free

`CHANGELOG.md` no longer contains the LLM summary, categories, rewritten entries or `notes.releaseNotes.links`
section in any mode; it lists the commit-derived entries by change type. The LLM output stays in the release notes.
`notes generate` skips its LLM tasks unless it writes release notes (`--release-notes-dir`).

### Tag names follow the tag config

- `version.packageSpecificTags: true` without a `tagTemplate` tags each package `scope-pkg@v1.2.3`; it used to
  give every package the same `v1.2.3` tag. With `packageSpecificTags`, a `tagTemplate` must contain
  `${packageName}`.
- Sync mode (the default) tags with `version.tagTemplate`, which it used to ignore.
- `version.versionPrefix: ""` gives `1.2.3` tags; it used to give `v1.2.3`.
- `version.tagTemplate` and `version.baselineTagTemplate` must end with `${version}` and can't contain a version before it (`releases/2026.1.0/${version}`); config loading fails otherwise.

A release finds the previous one by its tag name. If your tag names change, tag your last release's commit under
the new name before the next release, e.g. `git tag scope-pkg@v1.2.3 v1.2.3^{}`, and push it.

### `standing-pr merge` only merges

- `--publish` is removed. The publish workflow publishes the merged PR, as for a merge in GitHub's UI. Set
  `GITHUB_TOKEN` to a personal access token or GitHub App token for `merge`, since a merge made with the workflow's
  default token doesn't start the publish workflow.
- `merge` refuses to merge unless the release manifest passes the checks `standing-pr publish` runs.
- `merge` no longer deletes the release branch; the publish does.

### `version` reads `--config` like the other commands

- `version --project-dir <dir> --config <path>` reads a relative `--config` from the directory you run in, as
  `release` does; it used to read it from `<dir>`.
- A missing `--project-dir` folder fails `version` with exit code 3; it used to exit 1.

### Version mismatches warn without a version block

With no `version` block, a mismatch between `package.json` and the latest tag warns (`mismatchStrategy: "warn"`, as
with a `version` block); it used to fail.

### Changelogs always prepend

- `notes.updateStrategy` is removed, and config loading fails if it's set. The notes CLI's `--regenerate` is removed.
- New versions go below any `## [Unreleased]` section and above the newest version heading, whether that's `# `, `## `
  or `### `. They used to go above the first `## ` line.
- A custom changelog template (`notes.changelog.templates`) no longer overwrites the file: its output from the first
  version heading goes under the existing header. See
  [Templates](../packages/notes/docs/templates.md#writing-to-an-existing-changelog).
- In `packages` and `both` modes, per-package changelogs use the custom template too.
- `@releasekit/notes` API: `writeMarkdown` is replaced by `writeChangelog(path, content, dryRun)`, which prepends
  rendered content, and `writeMonorepoChangelogs` takes a render function instead of `config` and `refs`.

### `primaryPackages` moved to `version`

`ci.standingPr.primaryPackages` is now `version.primaryPackages`; config loading fails on the old key.
`ci.standingPr.selection` stays where it is.

### Changelog entries render the same everywhere

- Every surface writes an entry as `- **scope**: description (refs)`; standing-PR rows, the preview and
  `body: changelog` release bodies used to put the scope after the description.
- No entry has a `**BREAKING**` prefix; the Breaking section marks it.
- `body: changelog` release bodies have section headings instead of a flat list.
- LLM categories no longer group entries by scope inside a category.
- `notes.changelog.demoteScopes` is removed, and config loading fails if it's set. `deps` and `deps-dev` entries
  always go last, under "Dependencies & version bumps", now in `CHANGELOG.md` and release bodies too.
- A `<!--` inside a code span gets a zero-width space on every surface, as standing-PR rows already did.

### Templates get sections

- `enhanced.categories` is removed from the template context. Use `sections`, which holds the LLM categories when
  `categorize` ran and the commit-type groups otherwise, Breaking first.
- `enhanced` is set only when the `summarize` or `releaseNotes` task produced text.
- Each entry has `line`, the rendered Markdown line. The bundled templates use `sections` and `line`, so their
  sections and entry lines match the built-in renderer's. See
  [Templates](../packages/notes/docs/templates.md#sections).

### Project-wide changes reach the notes

In async mode (`sync: false`, no `groups`, more than one package in the run):

- Commits touching a `version.sharedPackages` package and no non-shared package are listed under
  `### Project-wide changes` in every released package's changelog, release notes and release body
  (`body: changelog` included), listing the ones since that package's previous release. They used to appear only in
  the standing PR and the preview.
- A root changelog lists every project-wide entry once per run, under `## Project-wide changes - <date>` after the
  run's versions.
- Templates get `shared` on each version, and the bundled templates render it. See
  [Monorepo Support](../packages/notes/docs/monorepo.md#project-wide-changes).

### Primaries bundle their packages' releases

- In async mode or grouped releases with per-package tags and `version.primaryPackages` set, a primary's release
  notes and GitHub release body end with a section for each group-mate and internal dependency that released since
  the primary's previous release. See
  [Monorepo Support](../packages/notes/docs/monorepo.md#bundled-release-notes).
- Templates get `bundled` on each version, and a root changelog's document gets the run's project-wide entries as
  `shared`. The bundled templates render both.

### Standing PRs don't write release-notes files

With `ci.releaseStrategy: "standing-pr"`, config loading now fails if `notes.releaseNotes.file` is set; remove it.
Standing-PR release notes go to the GitHub release only, and publish tags the merged release commit rather than a
separate notes commit.

### The standing-PR workflow writes only on `main`

The [standing-PR example](../examples/ci/standing-pr/standing-pr.yml) no longer publishes from `pull_request` events.
If your workflow is a copy of the old one, with `publish`, `retry-publish` and `immediate-release` jobs on
`pull_request: closed` and `labeled`, its `retry-publish` job checks out `main`, which `standing-pr publish` now refuses
once anything has landed after the merge. Replace it to get the layout in
[CI setup](../packages/release/docs/ci-setup.md#workflow):

1. Create a `release` environment restricted to `main`, with no required reviewers, and move registry secrets such as
   `NPM_TOKEN` into it. See [The release environment](../packages/release/docs/ci-setup.md#the-release-environment).
2. Replace `standing-pr.yml` with the new example, carrying over your LLM keys and any edited label names or branch
   prefixes. Its `pull_request` trigger drops `closed`, and it adds `workflow_dispatch`.
3. Add the `release` environment to each registry's trusted-publisher settings.
4. Optionally, add [the release App](../packages/release/docs/ci-setup.md#the-release-app-optional).

Switch while no release is publishing, so a merge's publish doesn't fall between the two workflows.

CLI changes back it, and apply to any workflow:

- `standing-pr publish` on a `push`, without `--pr`, publishes the merged standing PR still waiting for its tags and
  does nothing when there is none. It used to publish the most recently merged standing PR again.
- `standing-pr update` on a `workflow_dispatch` run updates even when the checkout is a release commit, and `--ack`
  shows its banner, as on a label or body edit.
- `standing-pr publish` refuses, as a retryable refusal, unless the checkout is the standing PR's merge commit.
  `standing-pr resolve` prints the standing PR to publish and that commit.

---

## Further reading

- [Getting started](./getting-started.md) — installation and first release
- [Configuration reference](./configuration.md) — all `releasekit.config.json` keys
- [CI setup](../packages/release/docs/ci-setup.md) — how each CI setup works, including the standing PR
- [CI examples](../examples/README.md) — the workflows, validated in CI
- [@releasekit/release README](../packages/release/README.md) — CLI flags and programmatic API
