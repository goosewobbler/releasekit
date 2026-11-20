# 8. Versions live in a committed version record, not in tags

Date: 2026-11-20

## Status

Accepted. Implementation tracked in [#1066](https://github.com/goosewobbler/releasekit/issues/1066) and [#958](https://github.com/goosewobbler/releasekit/issues/958).

## Context

ReleaseKit finds a package's current version, and where its last release was, by searching git tags, with the manifest as a fallback. Tag names come from configurable templates, and tags get moved, sanitized or left behind by earlier tooling, so the search has many edge cases and each versioning strategy resolves them differently. `mismatchStrategy` and `baselineTagTemplate` exist to work around it.

The ecosystems on the roadmap make this harder: tag-only ecosystems such as Go have no manifest version to fall back to. release-please avoids the search by keeping versions in a committed file.

## Decision

**A committed version record, `releasekit.versions.json`, is the source of each package's current version and of where its last release was. Tags and package manifests are outputs.**

- Each entry records a package's version and the base-branch commit its release was computed at. The next release counts the package's commits after that one.
- Tags are written for consumers and GitHub Releases, but never read to work out a version or a release range. The exception is migration, which seeds the record from tags once.

## Consequences

- Versions and release ranges no longer depend on tag naming or moved tags, and the settings that work around the tag search go or change.
- Every ecosystem works the same way, including those with no manifest version and packages with more than one manifest.
- Each repo migrates once to create the record.
- The record is per-branch state, so releasing from more than one branch (a maintenance branch, say) needs a design of its own.
- In standing-PR mode, commits that land on `main` after the standing PR's last update ship in that release without informing its version, and are counted in the next one. Today they ship and are never counted.
- [#1066](https://github.com/goosewobbler/releasekit/issues/1066) specifies the record's format and the rules that keep it consistent.
