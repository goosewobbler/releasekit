# 8. A release unit's version comes from its own tag series, then its manifest

Date: 2026-11-20

## Status

Accepted. Implementation tracked in [#958](https://github.com/goosewobbler/releasekit/issues/958).

## Context

`CONTEXT.md` defines a package's version source as its own tag, then its manifest version, then `0.1.0`. The strategies drifted from that, in five variants. Sync, single and group fall back to the latest repo-level tag (`vX.Y.Z`) when a package has no tag of its own; async reads the manifest first and uses the repo-level tag only when the manifest has no version.

For a package on its own version line, the latest repo-level tag is another release's version. Under the default `mismatchStrategy`, a package added at `0.1.0` to a repo tagged `v2.3.0` releases as `2.3.1` or `2.4.0` in group mode, and as `0.1.1` or `0.2.0` in async mode. Adding `groups` to a config changes the version of a package that isn't in any group.

The repo-level tag is still a good bound for which commits count: it marks the last release the package shipped in, if any. Treating one tag as both the version source (A) and the commit floor (B) is the conflation `CONTEXT.md` warns against.

## Decision

**A release unit's version comes from its own tag series, then its manifest, then `0.1.0`. A tag outside that series is never its version source.**

- A release unit is what the version step releases as one: the whole repo in sync mode, the one package in single mode, otherwise each package.
- Its own tag series is the series its own tags are named in.
- Packages released on separate version lines must therefore have their own series: their tag names must include the package.
- The commit range is a separate question, and this decision doesn't change it. A unit with no own tag still counts commits from the repo-level tag.

## Consequences

- One rule for every strategy, so the version-source code exists once.
- A package gets the same version whether or not the config has groups.
- A package with no tag of its own that used to start from the repo-level tag now starts from its manifest, or from `0.1.0` when the manifest has no version, and counts as a first release.
- A run that releases packages on separate version lines with tag names that don't include the package fails instead of mixing their versions.
- #958 lists the implementation requirements and the migration steps for affected configs.
