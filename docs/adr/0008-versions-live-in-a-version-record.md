# 8. Versions live in a committed version record, not in tags

Date: 2026-11-20

## Status

Accepted. Implementation tracked in [#1066](https://github.com/goosewobbler/releasekit/issues/1066) and [#958](https://github.com/goosewobbler/releasekit/issues/958).

## Context

ReleaseKit works out a package's current version, and where its last release was, by searching git tags. Tag names come from configurable templates. Tags can be moved off the branch, missing from a shallow clone, sanitized, or left over from earlier tooling. When the search finds nothing, it falls back to the manifest or to another release's tag, and settings such as `mismatchStrategy` and `baselineTagTemplate` exist to work around the search.

A draft ADR that tried to define one consistent rule for the search ([#1060](https://github.com/goosewobbler/releasekit/pull/1060)) didn't converge over twenty review rounds: each round found another case where tag naming, reachability or the manifest comparison changed the answer. Planned ecosystems add more cases: tag-only ecosystems and Go have no version in any manifest. release-please keeps versions, though not release ranges, in a committed manifest file; recording where each release was computed is this ADR's addition.

## Decision

**A committed version record is the only source of a package's current version and of its last release. Package manifests (`package.json`, `Cargo.toml`, ...) and tags are outputs.**

- Each package's entry records its version and the commit its release was computed at, and a prerelease entry also records its last stable release. The next release counts the commits after the recorded commit; a stable release after prereleases counts from the last stable one.
- Tags are created for consumers and GitHub Releases, but never read to work out a version or a release range.

## Consequences

- Version and range no longer depend on tag naming or moved tags, and the settings that exist to work around the tag search go. The range still needs each entry's commit in the clone's history.
- Every ecosystem works the same way, including those with no version in a manifest and packages with more than one manifest.
- Each repo adopts the record once, through a migration step.
- The record is per-branch state: releasing from more than one branch, such as a maintenance branch, means reconciling records on merge, which needs a design of its own.
- The record's format, packages with no entry, hand edits to the record or to package manifests, the rules that keep it consistent, migration and recovery are specified in [#1066](https://github.com/goosewobbler/releasekit/issues/1066).
