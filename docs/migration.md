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
| LLM-enhanced changelogs | no | no | yes |
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
| `branches` config | `version.branchPatterns` |
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
   - The commit preset defaults to `conventional`. If you were using `angular` in
     `@semantic-release/commit-analyzer`, set `"version": { "preset": "angular" }` to
     preserve your existing changelog groupings.

4. **Replace the workflow step.** Remove the semantic-release step from your GitHub Actions
   workflow and add `releasekit release` in its place. A minimal replacement:

   ```yaml
   - run: pnpm exec releasekit release
     env:
       GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
   ```

   See [CI setup](../packages/release/docs/ci-setup.md) for complete workflow examples
   including OIDC publishing and label-based triggers.

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
| `.changeset/*.md` files | `bump:*` PR labels (or conventional commits) |
| `pnpm changeset` (create changeset) | Add `bump:minor` (or other) label to the PR |
| `pnpm changeset version` | `releasekit standing-pr update` |
| "Version Packages" PR | Standing release PR (`ci.releaseStrategy: "standing-pr"`) |
| `pnpm changeset publish` | `releasekit standing-pr publish` (or `releasekit release`) |
| `.changeset/config.json` | `releasekit.config.json` |
| `fixed` packages (move together) | `version.sync: true` |
| `linked` packages | Not directly supported; use `version.sync` |
| `ignore` packages | `version.skip` array |

The main conceptual shift is that bump intent moves from committed markdown files to PR labels.
This keeps your repository history clean and avoids merge conflicts on `.changeset/` files in
active monorepos.

### Why the standing-PR strategy feels most familiar

Changesets users are used to reviewing a "Version Packages" PR before publishing. The
`standing-pr` strategy is the direct analogue: ReleaseKit maintains a PR that accumulates
releasable changes, shows what will be released, and publishes when you merge it.

With `ci.standingPr.editableNotes: true`, you can edit the release notes directly in the PR
description before merging — changes are preserved across updates and flow through to the
published GitHub Release and changelog.

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
       "releaseStrategy": "standing-pr",
       "standingPr": {
         "editableNotes": true
       }
     },
     "publish": {
       "npm": { "enabled": true }
     }
   }
   ```

3. **Choose a release trigger.**
   - `"releaseTrigger": "commit"` — conventional commits drive bump types automatically.
     Every merged PR can contribute to the standing PR. This is the closest equivalent to
     changesets' commit-driven mode.
   - `"releaseTrigger": "label"` — explicit `bump:patch/minor/major` labels on each PR
     control the bump type, analogous to choosing the bump level when running
     `pnpm changeset`.

4. **Add the standing-PR workflow.** Copy the template from
   `templates/workflows/standing-pr.yml` into `.github/workflows/`. See
   [CI setup](../packages/release/docs/ci-setup.md#standing-release-pr) for the full
   workflow YAML, required secrets, and lifecycle details.

5. **Enable Actions write access.** Go to your repository Settings > Actions > General and
   enable "Allow GitHub Actions to create and approve pull requests". This is required for
   the bot to manage the release PR.

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

## Further reading

- [Getting started](./getting-started.md) — installation and first release
- [Configuration reference](./configuration.md) — all `releasekit.config.json` keys
- [CI setup](../packages/release/docs/ci-setup.md) — complete GitHub Actions workflow recipes
- [@releasekit/release README](../packages/release/README.md) — CLI flags and programmatic API
