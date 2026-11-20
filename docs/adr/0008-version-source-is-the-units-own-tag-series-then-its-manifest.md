# 8. A release unit's version comes from its own tag series, then its manifest

Date: 2026-11-20

## Status

Accepted. Implementation tracked in [#958](https://github.com/goosewobbler/releasekit/issues/958).

## Context

`CONTEXT.md` defines a package's version source as its own tag, then its manifest version, then `0.1.0`. The strategies drifted from that. Sync, single and group fall back to the latest repo-level tag (`vX.Y.Z`) when a package has no tag of its own; async reads the manifest first and uses the repo-level tag only when the manifest has no version. `detectChangedPackages` has a fifth variant. Group mode also looks up baseline tags without a package name, so with `baselineTagTemplate: "release/${prefix}${version}"` a package can start from another package's baseline tag.

For a package on its own version line, the latest repo-level tag is another release's version. Under the default `mismatchStrategy` (`warn`), `getBestVersionSource` takes the tag whenever it's higher than the manifest, warning only when it's a minor or major ahead, or a stable tag over a prerelease manifest. So a package added at `0.1.0` to a repo tagged `v2.3.0` releases as `2.3.1` or `2.4.0` in group mode, and as `0.1.1` or `0.2.0` in async mode. Adding `groups` to a config changes the version of a package that isn't in any group.

The repo-level tag is still a good changelog floor for such a package: it bounds which commits are listed. Treating one tag as both the version source (A) and the floor (B) is the conflation `CONTEXT.md` warns against.

## Decision

**A release unit's version comes from its own tag series, then its manifest, then `0.1.0`.**

- A release unit is what the version step releases as one: the whole repo in sync mode, the one package in single mode, otherwise each package.
- Its own tag series is the one `tagTemplate` names its tags in. For sync and single that's the repo's (`v1.2.3`), or with `packageSpecificTags` the main or single package's (`pkg@v1.2.3`). For every other package, grouped members included, it's the package's own. A group's shared version is computed from its members' version sources, so it needs no series of its own.
- Its manifest is the one it releases from. For sync that's `mainPackage`'s, else the first discovered package's, never the root `package.json`, which often holds a placeholder. A `mainPackage` that isn't found is an error.
- `baselineTagTemplate`, when set, replaces the tag lookup in every strategy. When a run releases packages on separate version lines (async or group), it must contain `${packageName}`, so each package's baseline tags form their own series. The version step checks this once packages are resolved, since single mode is chosen from the package count.
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
- Single and async mode now look up baseline tags when `baselineTagTemplate` is set, as sync and group do. They never created any (#959), so their first run after this starts from the manifest.
- A run that releases packages on separate lines with a `baselineTagTemplate` lacking `${packageName}` now fails. In group mode it could already give a package another package's version.
- A sync `mainPackage` that isn't found fails the run instead of falling back to the root `package.json`.
