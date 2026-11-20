# 8. A version unit's version comes from its own tag series, then its manifest

Date: 2026-11-20

## Status

Accepted. Implementation tracked in [#958](https://github.com/goosewobbler/releasekit/issues/958).

## Context

`CONTEXT.md` defines a package's version source as its own tag, then its manifest version, then `0.1.0`. The four strategies drifted from that. When a package has no tag of its own, group mode falls back to the latest repo-level tag (`vX.Y.Z`), and so do sync and single with `packageSpecificTags`. With `baselineTagTemplate` set, group and sync mode use the repo-level baseline tag even for a package that has its own tags. Async reads the manifest first and uses the repo-level tag only when the manifest has no version. (`detectChangedPackages` also reads the repo-level tag, but only as a commit floor, which this decision keeps.)

For a package that can be at its own version, the latest repo-level tag is another release's version. Under the default `mismatchStrategy`, a package added at `0.1.0` to a repo tagged `v2.3.0` releases as `2.3.1` or `2.4.0` in group mode, and as `0.1.1` or `0.2.0` in async mode. Adding `groups` to a config changes the version of a package that isn't in any group.

The repo-level tag is still a good bound for which commits count. Treating one tag as both the version source (A) and the commit floor (B) is the conflation `CONTEXT.md` warns against.

## Decision

**A version unit's version comes from its own tag series, then its manifest, then `0.1.0`. A tag outside that series is never its version source.**

- A version unit is what has its own version source: the whole repo in sync mode, otherwise each package. (It differs from a *release unit*, the `primaryPackages` selection unit.) A `fixed` or `linked` group's members are separate units; the group sets their shared version from all of them.
- Its own tag series is the series `tagTemplate` names its own tags in. For a sync or single unit with the default template that's the repo's (`v1.2.3`); with a template that names the package, it's that package's (`pkg@v1.2.3`).
- The manifest is still compared with the tag as today: a newer manifest wins, subject to `mismatchStrategy`.
- Packages that can be at different versions must therefore have their own series: their tag names, and their baseline-tag names when `baselineTagTemplate` is set, must include the package. Members of one `fixed` group are released at one version, so they may share a series.
- The repo-level tag stays the commit floor. For a unit with no own tag, #958 sets the bump range to it explicitly (to the latest baseline tag when `baselineTagTemplate` is set) instead of leaving it to conventional-recommended-bump's own lookup.

## Consequences

- One rule for every strategy, so the version-source code exists once, apart from the group-baseline exception below.
- A package outside any group gets the same version whether or not the config has groups.
- A package with no tag of its own that used to start from the repo-level tag now starts from its manifest, or from `0.1.0` when the manifest has no version. It counts as a first release, with no `previousVersion`, and the first-release bump guard applies.
- A run in which packages can be at different versions, with tag or baseline-tag names that don't include the package, fails instead of mixing their versions.
- #958 lists the implementation requirements, including the exception that a group member's baseline stays the higher of its tag and manifest, and the migration steps for affected configs.
