# The standing-PR body is an interface

In standing-PR mode, releasekit keeps one open pull request describing the next release. Parts of its body are read back by the bot and decide what ships, so reflowing the markdown or stripping HTML comments can change the release without looking wrong in review. This page lists those parts, what an edit to each does, and what is bot-owned.

## The regions

Every input in the body is delimited by an HTML comment marker. **The markers are the contract.** The bot never parses the surrounding prose — it slices between markers and, for checkboxes, reads only the `[x]` / `[ ]` glyph on the marker's own line. That means you can reword a row's visible label freely; you cannot move, edit, or delete its marker.

| Marker | What it is | What an edit does |
|---|---|---|
| `<!-- releasekit-notes:<pkg> -->` … `<!-- releasekit-notes-end:<pkg> -->` | Editable release notes, one region per releasing package, keyed by package name even when only one package releases. A `sync` release without `packageSpecificTags` has a single region, keyed by `version.mainPackage`, else `monorepo` | Text inside **replaces** the generated release notes for that package, at publish |
| `<!-- rk-sel:<pkg> -->` | A row in the **Packages to release** checklist | Unticking asks the bot to hold that package back from the next release |
| `<!-- rk-pre:<pkg> -->` | Channel toggle on a stable row | Ticking asks the bot to ship that package as a prerelease |
| `<!-- rk-grad:<pkg> -->` | Channel toggle on a prerelease row | Ticking asks the bot to graduate that package to stable |
| `<!-- releasekit-manifest -->` | The release manifest, in a bot comment | **Bot-owned.** Drives the entire publish |

The checklist rows live inside `<!-- releasekit-selection -->` … `<!-- releasekit-selection-end -->`, and the manifest lives in its own comment rather than the body.

### The checklist and channel toggles

A tick or untick takes effect only when the next `standing-pr update` run rebuilds the PR: immediately if your workflow listens for `pull_request: edited` (the [example](../examples/ci/standing-pr/standing-pr.yml) does), otherwise on the next push or scheduled run. Merge only after the rebuilt body shows the change — publish reads the manifest, not the body, so merging earlier ships the previous selection. With [`authorization`](#who-can-change-what) set, only an `edited`-triggered run by an authorized actor applies it.

- Sync releases have no checklist — they ship as one unit.
- In the flat and granular lists, a member of a `fixed` or `linked` group can't be held back on its own; its untick is ignored and the row re-ticks.
- With [`ci.standingPr.primaryPackages`](./configuration.md#cistandingpr) in the default `streamlined` mode, only primaries (and packages outside every unit) have checkboxes; unticking a primary holds back its unit, except members it shares with another selected primary.
- The `rk-pre` / `rk-grad` toggles appear only with `ci.standingPr.channelToggle: true`. A toggle moves the package's whole group, a held-back row's toggle is ignored, and a package set to both prerelease and graduate (say, `rk-pre` plus a `graduate:` label) goes prerelease.

### Editable release notes

Only present when the standing PR carries the preview-notes label (`release:preview-notes` by default — see [`ci.labels`](./configuration.md#cilabels)). With the label on, releasekit generates notes into the region once; edits made there survive the branch being regenerated and force-pushed, and are what lands in the GitHub Release (with the default `publish.githubRelease.body: "auto"`).

Write inside the markers. Content outside them is regenerated. Each package's notes, edits included, are capped at 8,000 characters in the region; anything longer is cut, and the cut text is what publishes.

Edits can still be lost or bypassed:

- An emptied region falls back to generated notes.
- Removing the label removes the region.
- An edit saved while an update is rewriting the body can be overwritten.
- Only the GitHub Release gets your edits; a file written by `notes.releaseNotes.file` gets generated notes.

### The manifest

The manifest comment carries the machine state for the merge: the computed versions, the base SHA the plan was built against, the labels in force, and the selection and channel choices. At publish it's checked against the merged source, so it can't publish anything that isn't in the merged code (see **Manifest integrity** under [Label semantics in standing-pr mode](../packages/release/docs/ci-setup.md#label-semantics-in-standing-pr-mode)). It isn't tamper-proof, though, so treat edits to it as unsupported.

Don't edit it. To regenerate it, re-run the Standing Release PR workflow, or wait for the next push or scheduled run. Don't run `standing-pr update` from a local checkout to do it: the command discards uncommitted changes, commits any untracked files along with the version bumps, and force-pushes the release branch with your credentials — and outside the workflow it can leave the branch and the manifest out of step.

## Who can change what

Two different rules, and the difference is worth knowing before you rely on either.

**Selection, channel, and release-control labels are authorization-gated** when [`ci.standingPr.authorization`](./configuration.md#cistandingpr) is configured. The release-control labels are the standing PR's `bump:major` / `bump:minor` / `bump:patch`, `channel:prerelease`, `release:graduate`, `graduate:<pkg>` and `release:with-prerequisites` labels, plus your `ci.scopeLabels` keys (default names shown; see [`ci.labels`](./configuration.md#cilabels)). `release:preview-notes`, `release:immediate`, `release:retry` and `release:skip` are not gated. An edit from an actor without the required permission is **reverted** by the update run it triggers — the checklist and labels are reset to the approved state and a comment explains why. Bot and GitHub App actors always count as authorized.

**Release-notes prose is not gated.** Anyone who can edit the PR body can change the text that ships in the GitHub Release. The publish path reads the region from the live body with no author check. That is a deliberate difference in kind — prose doesn't decide what version of what package goes to a registry — but it does mean the notes region inherits whatever your repository's write access already allows.

Neither replaces the merge gate: merging the standing PR is the publish, so a review-required ruleset on `main` is what protects it. See [Branch rulesets](../packages/release/docs/ci-setup.md#branch-rulesets-the-merge-gate).

## For agents

If you are an AI agent working in a repository with an open standing release PR: don't reformat the body, don't touch any marker, and change notes, checklist rows or release labels only when asked. The full rules, as a paste-ready `AGENTS.md` snippet, are in [Agents](./agents.md#agentsmd-snippet).
