# 8. Versions live in a committed version record

Date: 2026-11-20

## Status

Accepted. Implementation tracked in [#1066](https://github.com/goosewobbler/releasekit/issues/1066) and [#958](https://github.com/goosewobbler/releasekit/issues/958).

## Context

ReleaseKit finds a package's current version, and where its last release was, by searching git tags, with the manifest as a fallback. Tag names come from configurable templates, and tags get moved, sanitized or left behind by earlier tooling, so the search has many edge cases and each versioning strategy resolves them differently. `mismatchStrategy`, `baselineTagTemplate` and `strictReachable` exist to work around it.

The ecosystems on the roadmap make this harder: tag-only ecosystems such as Go have no manifest version to fall back to. release-please keeps versions in a committed file; recording each release's commit as well is new here.

## Decision

**A committed version record, `releasekit.versions.json`, is the source of each package's current version and of where its last release was.**

- Each entry records a package's version and the base-branch commit its release was computed at, and a prerelease entry also records its last stable release. Past releases since migration come from the record's history; backfill still reads tags for earlier ones.
- The version step updates the record in the release commit, alongside the manifest bumps.
- Tags are never read to compute a package's next version or its commit range. Migration seeds the record from them.

## Consequences

- After migration, versions and release ranges no longer depend on tag naming or moved tags, and the settings that work around the tag search go or change. Ranges depend instead on each recorded commit being in the clone's history; a clone without it, such as a shallow one, fails the version step.
- Every ecosystem works the same way, including those with no manifest version and packages with more than one manifest.
- Each repo migrates once to create the record.
- In standing-PR mode, a commit that lands on `main` after the standing PR's last update ships with that release but appears in the next release's changelog and bump. Today such a commit ships without ever being counted.
- Each branch carries its own copy of the record, so a maintenance branch releases from its own entries. Merging it back means reconciling the two records, as #1066 specifies.
- [#1066](https://github.com/goosewobbler/releasekit/issues/1066) specifies the record's format and the rules that keep it consistent.
