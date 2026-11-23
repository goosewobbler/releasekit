# 8. Versions live in a committed version record

Date: 2026-11-20

## Status

Accepted. Implementation tracked in [#1066](https://github.com/goosewobbler/releasekit/issues/1066) and [#958](https://github.com/goosewobbler/releasekit/issues/958). Amended 2026-11-23, while #958 was in progress: seeding is temporary, and records on different branches aren't reconciled automatically.

## Context

ReleaseKit finds each package's current version and last release by searching git tags, falling back to the manifest. Tag names come from configurable templates, and tags get moved, sanitized or left behind by earlier tooling, so the search has many edge cases that each strategy handles differently. `mismatchStrategy`, `baselineTagTemplate` and `strictReachable` exist to work around it.

Planned tag-only ecosystems, such as Go, have no manifest version to fall back to. release-please keeps versions in a committed file; this ADR also records each release's commit.

## Decision

**A committed record, `releasekit.versions.json`, holds each package's current version and where its last release was.**

- Each entry holds the package's version and the base-branch commit its release was computed at. A prerelease entry also holds its last stable release's version and commit. Past releases come from the record's history.
- The version step updates the record in the release commit, alongside the manifest bumps.
- Once a package has an entry, tags are never read to compute its next version or its commit range. Until the existing consumers (this repo, zubridge and wdio-desktop-mobile) have each released with a record, migration seeds each entry with the version and commit today's tag search resolves; then seeding goes, with the version step's tag search. Backfill still reads tags for releases made before migration.

## Consequences

- After migration, tag naming and moved tags no longer affect versions or ranges. The settings that work around the tag search go, the last of them with seeding. A recorded commit that isn't an ancestor of `HEAD`, as in a shallow clone, fails the version step.
- Every ecosystem works the same way, including those with no manifest version and packages with more than one manifest.
- Each existing repo migrates once. Once seeding has gone, the version step fails in a repo without a record: `releasekit init` writes an empty one, and a repo that adopts ReleaseKit with existing releases writes an entry per package. A package that joins a recorded repo with existing releases needs a hand-written entry, or it starts from its manifest and counts its whole history.
- In standing-PR mode, a commit that lands on `main` after the standing PR's last update ships in that release but is counted in the next one. Today it ships uncounted.
- Each branch keeps its own record, so a maintenance branch releases from its own entries. A conflict in the record when it merges back is resolved by hand.
- [#1066](https://github.com/goosewobbler/releasekit/issues/1066) specifies the record's format and the rules that keep it consistent.
