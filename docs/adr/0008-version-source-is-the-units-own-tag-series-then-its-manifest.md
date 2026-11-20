# 8. A release unit's version comes from its own tag series, then its manifest

Date: 2026-11-20

## Status

Accepted. Implementation tracked in [#958](https://github.com/goosewobbler/releasekit/issues/958).

## Context

`CONTEXT.md` defines a package's version source as its own tag, then its manifest version, then `0.1.0`. The strategies drifted from that. Sync, single and group fall back to the latest repo-level tag (`vX.Y.Z`) when a package has no tag of its own; async reads the manifest first and uses the repo-level tag only when the manifest has no version. `detectChangedPackages` has a fifth variant. Group mode also looks up baseline tags once for the whole run, without a package name: a template without `${packageName}` gives a package whichever package's baseline tag is latest, and one with it finds none. With `packageSpecificTags` off, async and ungrouped packages are all tagged in the repo series (`v1.2.3`), so packages on separate version lines share one series.

For a package on its own version line, the latest repo-level tag is another release's version. Under the default `mismatchStrategy` (`warn`), `getBestVersionSource` takes the tag whenever it's higher than the manifest, warning only when it's a minor or major ahead, or a stable tag over a prerelease manifest. So a package added at `0.1.0` to a repo tagged `v2.3.0` releases as `2.3.1` or `2.4.0` in group mode, and as `0.1.1` or `0.2.0` in async mode. Adding `groups` to a config changes the version of a package that isn't in any group.

The repo-level tag is still a good changelog floor for such a package: it bounds which commits are listed. Treating one tag as both the version source (A) and the floor (B) is the conflation `CONTEXT.md` warns against.

## Decision

**A release unit's version comes from its own tag series, then its manifest, then `0.1.0`.**

- A release unit is what the version step releases as one: the whole repo in sync mode, the one package in single mode, otherwise each package.
- Its own tag series is the one `tagTemplate` names its tags in. For sync and single that's the repo's (`v1.2.3`), or with `packageSpecificTags` the version source package's (`pkg@v1.2.3`). For every other package, grouped members included, it's the package's own. A group's shared version is computed from its members' versions, so it needs no series of its own.
- Its manifest is the one it releases from. For sync that's the version source package's: `mainPackage`, else the first package in the release. Never the root `package.json`, which often holds a placeholder. `mainPackage` is looked up among all discovered packages, so a private or filtered-out one still supplies the version; one that isn't discovered at all is an error.
- `baselineTagTemplate`, when set, replaces the tag lookup in every strategy, per unit.
- When a run releases packages on separate version lines (async or group), both its tags and its baseline tags must name the package: `packageSpecificTags` or `${packageName}` in `tagTemplate`, and `${packageName}` in `baselineTagTemplate`. Each package then has its own series. The version step checks this once packages are resolved, since single mode is chosen from the package count.
- A tag outside the unit's own series is never its version source.
- The commit range is unchanged. With no own tag, the bump and prerequisite change detection still count from the latest repo-level tag, as conventional-recommended-bump does today, and the changelog from `BaselineResolver`'s nearest reachable tag.

## Consequences

- One rule for every strategy, so the version-source code exists once (#958).
- A package gets the same version whether or not the config has groups.
- Behaviour changes, each for a package with no tag of its own:
  - in group mode, one whose manifest is behind the repo's tags starts from its manifest. After a migration from sync every manifest equals the repo version, so migrated repos are unaffected;
  - in async mode, one whose manifest has no version starts from `0.1.0` instead of the repo-level tag. This also covers tag-only ecosystems, whose manifests hold no version;
  - in sync and single mode with `packageSpecificTags`, the repo-level tag is no longer a fallback. Sync bumps every manifest each release, so its main package's manifest usually matches that tag anyway;
  - the unit counts as a first release: `action: 'first-release'`, and the first-release warning and bump guard apply.
- Single and async mode now look up baseline tags when `baselineTagTemplate` is set, as sync and group do. They never created any (#959), so their first run after this starts from the manifest. A repo whose manifest lags its tags, such as one with npm versioning off, should tag its last release with the baseline template before upgrading, or that run goes backwards.
- Group mode finds each member's baseline tags when the template names the package.
- A run that releases packages on separate lines without the package in its tag or baseline-tag names now fails. Such tags already collided or crossed between packages.
- A sync `mainPackage` that isn't discovered fails the run instead of falling back to the root `package.json`.
