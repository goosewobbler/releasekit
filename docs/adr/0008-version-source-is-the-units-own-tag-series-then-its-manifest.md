# 8. A release unit's version comes from its own tag series, then its manifest

Date: 2026-11-20

## Status

Accepted. Implementation tracked in [#958](https://github.com/goosewobbler/releasekit/issues/958).

## Context

`CONTEXT.md` defines a package's version source as its own tag, then its manifest version, then `0.1.0`. The strategies drifted from that. Sync, single and group fall back to the latest repo-level tag (`vX.Y.Z`) when a package has no tag of its own; async reads the manifest first and never uses the repo-level tag. `detectChangedPackages` has a fifth variant.

For a package on its own version line, the latest repo-level tag is another release's version. `getBestVersionSource` takes the tag whenever it's higher than the manifest, warning only when it's ahead by a minor or major. So a package added at `0.1.0` to a repo tagged `v2.3.0` releases as `2.3.1` or `2.4.0` in group mode, and as `0.1.1` or `0.2.0` in async mode. Adding `groups` to a config changes the version of a package that isn't in any group.

The repo-level tag is still a good changelog floor for such a package: it bounds which commits are listed. Treating one tag as both the version source (A) and the floor (B) is the conflation `CONTEXT.md` warns against.

## Decision

**A release unit's version comes from its own tag series, then its manifest, then `0.1.0`.**

- A release unit is what the version step releases as one: the whole repo in sync mode, the one package in single mode, otherwise each package.
- Its own tag series is the one its tags are named in: the repo's for sync, `tagTemplate`'s for single, and the package's own for every other package, grouped members included. A group's shared version is computed from its members' versions, so it needs no series of its own.
- `baselineTagTemplate`, when set, replaces the tag lookup in every strategy.
- The repo-level tag is never a version source outside sync and single. It stays a changelog floor, through `BaselineResolver`'s nearest reachable tag.
- Change detection for prerequisites counts commits since the unit's own tag. With no own tag it counts all history: a package with no tag may never have been published, so it counts as changed.

## Consequences

- One rule for every strategy, so the version-source code exists once (#958).
- A package gets the same version whether or not the config has groups.
- Behaviour change: in group mode, a package or member with no tag of its own whose manifest is behind the repo's tags now starts from its manifest. After a migration from sync every manifest equals the repo version, so migrated repos are unaffected.
- Tag-only ecosystems, whose manifests hold no version, rely on the tag series alone. The rule already covers them.
