# The standing-PR body is an interface

In standing-PR mode, releasekit keeps one open pull request — the standing release PR — describing the next release. Its body is **not prose**. Parts of it are read back by the bot and decide what ships.

This matters because a pull request body is the one place people (and coding agents) edit freely. Reflowing the markdown, tidying the wording, or stripping HTML comments can change what gets published or break the region entirely, and none of it looks wrong in review — the prose still reads fine.

This page says which parts are inputs, what an edit does, and what is bot-owned.

## The regions

Everything machine-read is delimited by an HTML comment marker. **The markers are the contract.** The bot never parses the surrounding prose — it slices between markers and, for checkboxes, reads only the `[x]` / `[ ]` glyph. That means you can reword a row's visible label freely; you cannot move, edit, or delete its marker.

| Marker | What it is | What an edit does |
|---|---|---|
| `<!-- releasekit-notes -->` … `<!-- releasekit-notes-end -->`<br>(keyed `<!-- releasekit-notes:<pkg> -->` when multi-package) | Editable release notes, one region per releasing package | Text inside **replaces** the generated release notes for that package, at publish |
| `<!-- rk-sel:<pkg> -->` | A row in the **Packages to release** checklist | Unticking holds that package back from the next release |
| `<!-- rk-pre:<pkg> -->` | Channel toggle on a stable row | Ticking ships that package as a prerelease |
| `<!-- rk-grad:<pkg> -->` | Channel toggle on a prerelease row | Ticking graduates that package to stable |
| `<!-- releasekit-manifest -->` | The release manifest, in a bot comment | **Bot-owned.** Drives the entire publish |

The checklist rows live inside `<!-- releasekit-selection -->` … `<!-- releasekit-selection-end -->`, and the manifest lives in its own comment rather than the body.

### Editable release notes

Only present when the standing PR carries the preview-notes label (`release:preview-notes` by default — see [`ci.labels`](./configuration.md)). With the label on, releasekit generates notes into the region once; edits made there survive the branch being regenerated and force-pushed, and are what lands in the GitHub Release.

Write inside the markers. Content outside them is regenerated.

### The manifest

The manifest comment carries the machine state for the merge: the computed versions, the base SHA the plan was built against, and the labels in force. At publish it is validated against the merged source — versions are re-read from the actual package manifests, and the base SHA must be an ancestor of `HEAD` — so a hand-edited manifest is refused rather than trusted. Don't edit it; re-run `standing-pr update` to regenerate.

## Who can change what

Two different rules, and the difference is worth knowing before you rely on either.

**Selection, channel, and release-control labels are authorization-gated** when [`ci.standingPr.authorization`](./configuration.md) is configured. An edit from an actor without the required permission is **reverted** — the checklist is reset to the approved selection and a comment explains why. The manifest, not the body, is authoritative for these.

**Release-notes prose is not gated.** Anyone who can edit the PR body can change the text that ships in the GitHub Release. The publish path reads the region from the live body with no author check. That is a deliberate difference in kind — prose doesn't decide what version of what package goes to a registry — but it does mean the notes region inherits whatever your repository's write access already allows.

Neither substitutes for branch protection. The merge is the approval gate; a branch-protection ruleset on the release branch is what actually decides whether a release happens.

## For agents

If you are an AI agent working in a repository with an open standing release PR:

- **Don't reformat the PR body.** It contains machine-read regions. Reflowing markdown or stripping HTML comments can change what ships.
- **Don't edit, move, or delete any `<!-- releasekit-* -->` or `<!-- rk-* -->` marker.** Rewording a row's visible label is safe; touching its marker is not.
- **Write release notes only between the `releasekit-notes` markers**, and only when asked to.
- **Don't tick or untick checklist rows** unless the change is what was asked for — each one decides whether, and on which channel, a package releases.
- **Don't edit the manifest comment.** Re-run `releasekit standing-pr update` instead.
- **Don't publish, tag, or push directly.** The release happens on merge, from CI.

A paste-ready version of this list for your own `AGENTS.md` is in [Agents](./agents.md#agentsmd-snippet).
