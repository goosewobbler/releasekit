# 8. A version unit's version comes from its own tag series, then its manifest

Date: 2026-11-20

## Status

Accepted. Implementation tracked in [#958](https://github.com/goosewobbler/releasekit/issues/958).

## Context

`CONTEXT.md` defines a package's version source as its own tag, then its manifest version, then `0.1.0`. The four strategies drifted from that. When a package has no tag of its own, group mode falls back to the latest repo-level tag (`vX.Y.Z`), and so do sync and single with `packageSpecificTags`. With `baselineTagTemplate` set, group mode looks up baseline tags once for the run, without a package name: a template without `${packageName}` gives every package the repo's latest baseline tag, even one with tags of its own, and a template with it finds none. Async reads the manifest first and uses the repo-level tag only when the manifest has no version. With `packageSpecificTags` off, no strategy reads a package's own tags, even when `tagTemplate` names the package. (Prerequisite change detection also reads the repo-level tag, but only as a commit floor; the decision keeps a repo-level floor, defined below.)

For a package that can be at its own version, the latest repo-level tag is another release's version. Under the default `mismatchStrategy`, a package added at `0.1.0` to a repo tagged `v2.3.0` releases as `2.3.1` or `2.4.0` in group mode, and as `0.1.1` or `0.2.0` in async mode. Adding `groups` to a config changes the version of a package that isn't in any group.

The repo-level tag is still a good bound for which commits count. Treating one tag as both the version source and the bound on which commits count is the kind of conflation `CONTEXT.md` warns against.

## Decision

**A version unit's version comes from its own tag series, compared with its manifest as today, else its manifest, else `0.1.0`. A tag outside that series is never its version source.**

- A version unit is what has its own version source: the whole repo in sync mode, otherwise each package. (It differs from a *release unit*, the `primaryPackages` selection unit.) Sync is one unit because its version comes from one tag series; a `fixed` or `linked` group's members are separate units, and the group sets their shared version from all of them.
- Its own tag series is the series its own tags are named in: its consumer tags, or only its baseline tags when `baselineTagTemplate` is set. The tag names decide it: the configured `tagTemplate`, or the default one `packageSpecificTags` selects; the flag does nothing else. A template that doesn't name the package gives the repo's series (`v1.2.3`); one that does gives the package's (`pkg@v1.2.3`). With package-named tags, a sync unit's series is its `mainPackage`'s, so such a config must set `mainPackage`; picking by discovery order would change with every added package. A sync unit's manifest is `mainPackage`'s, else its first package's; a `mainPackage` that isn't in the release is an error, where today it falls back to the root `package.json`.
- The manifest is still compared with the tag as today: a newer manifest wins, subject to `mismatchStrategy`. One exception: a `fixed` or `linked` group member's baseline takes the higher of the two whatever `mismatchStrategy` prefers (a mismatch under `error` still aborts), so such a group never releases below a member's published version.
- Packages that can be at different versions must therefore have their own series: their tag names, and their baseline-tag names when `baselineTagTemplate` is set, must include the package. Only a sync unit, or the members of a config's single `fixed` group, may share a series; `linked` and `independent` members, ungrouped packages and several groups can't. The condition covers the configured packages, not one run's, so a targeted run can't get around it.
- For a unit with no own tag, the bump and change detection count commits from the latest reachable repo-level tag, one whose name includes no package, whether a consumer or a baseline tag and whatever the config's templates name now. A consumer tag moved off the branch isn't reachable, so it never counts. Without one, they count over the unit's own paths' whole history, since none of it has been released under releasekit. The changelog floor doesn't change.

## Consequences

- One rule for every strategy, so the version-source code exists once, apart from the group-baseline exception above.
- A package outside any group gets the same version source in group mode as in async mode.
- A package with no tag of its own that used to start from the repo-level tag now starts from its manifest, or from `0.1.0` when the manifest has no version. It counts as a first release, with no `previousVersion`, and the first-release bump guard applies.
- A config whose packages can be at different versions, with tag or baseline-tag names that don't include the package, fails at the version step instead of mixing their versions. That includes the default async config with several packages, since the default template is `${prefix}${version}`. This is a breaking change, accepted before 1.0.
- With `baselineTagTemplate` set, a unit with no baseline tag is a first release. That's new for async and single, which read consumer tags today and never created baseline tags (#959). A repo turning the template on, or upgrading in async or single mode with it on, tags its last release with the baseline template first.
- A config that renames `tagTemplate` or `baselineTagTemplate` to name the package, as the rule above requires, has no tags under the new names. It tags each package's last release under them first, or every package becomes a first release.
- A sync config with package-named tags and no `mainPackage`, or with a `mainPackage` outside the release, now fails at the version step.
- A config whose `tagTemplate` names the package with `packageSpecificTags` off starts reading its packages' own tags.
- #958 lists the implementation requirements and the migration steps for affected configs.
