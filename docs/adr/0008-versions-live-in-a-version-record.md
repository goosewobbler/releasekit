# 8. Versions live in a committed version record, not in tags

Date: 2026-11-20

## Status

Accepted. Implementation tracked in [#958](https://github.com/goosewobbler/releasekit/issues/958).

## Context

ReleaseKit works out a package's current version by searching git tags. Tag names come from configurable templates. Tags can be moved off the branch, missing from a shallow clone, sanitized, or left over from earlier tooling. When the search finds nothing, it falls back to the manifest or to another release's tag; when a tag and the manifest disagree, `mismatchStrategy` picks one. Baseline tags (`baselineTagTemplate`) exist to work around moved tags.

Each versioning strategy implements this search differently. A draft ADR that tried to define one rule for it ([#1060](https://github.com/goosewobbler/releasekit/pull/1060)) didn't converge over twenty review rounds: each round found another case where tag naming, reachability or the manifest comparison changed the answer.

The planned ecosystems make it harder. Tag-only ecosystems and Go have no version in any manifest, and Go needs tags prefixed with the module's directory. release-please avoids the search by keeping versions in a committed manifest file.

## Decision

**A committed version record is the only source of a package's current version and of its last release. Manifests and tags are outputs.**

- The record is `releasekit.versions.json` at the repo root. Each package's entry, keyed by its path, holds its version and `at`: the commit its release was computed at. A prerelease entry also holds the version and `at` of the package's last stable release, if it has one.
- The version step is the record's only automated writer. It reads each package's version from the record and writes the new version, with `at` set to the commit it ran on, to the record, the manifests and the tags.
- A package's bump, changelog and change detection count the commits in its paths after its `at`. A stable release after a prerelease series counts from its last stable `at`, or over its paths' whole history if it has never had a stable release.
- A package with no entry has never been released by ReleaseKit. It starts from its manifest version, else `0.1.0`, and every commit in its paths counts. In a `fixed` or `linked` group it takes the group's version, and its commits count from the group's oldest `at`.
- Anything that needs a package's past releases, such as bundled release notes or the project-wide changelog floor, reads them from the record's history, not from tags.
- Tags are created for consumers and GitHub Releases, but never read to work out a version. The version step fails if a tag it would create already exists, which stops a reverted record from releasing a version again.
- A key with no package at its path fails the version step; moving a package means moving its entry, `at` included.
- An `at` that isn't in the clone's history, as in a shallow clone, fails the version step.
- Editing an entry by hand declares that version released at the given `at`, as creating a tag by hand does today. A bump is still requested with labels or `--bump`.
- A release whose publish fails is completed by retrying it, not by the next release: the record already holds its versions.

## Consequences

- No version or release range is worked out from tags, so tag templates and moved tags stop mattering. History back to each package's `at` (its last stable `at`, for a graduation) still has to be fetched.
- Settings that exist for the tag lookup go: `mismatchStrategy`, `baselineTagTemplate` and `strictReachable`. A first release is one with no entry, which is what `allowFirstBump` then refers to. `packageSpecificTags` only shapes tag names.
- Every ecosystem works the same way: those with no version in a manifest, a package with more than one manifest, and configs that don't write a manifest's version.
- A squash-merged standing PR can't mark commits that landed after its last update as released, because `at` is the commit the release was computed at.
- Tag names still have to be unique ([#1045](https://github.com/goosewobbler/releasekit/issues/1045)).
- A version appears in two places, the record and the manifest. The record wins; a hand-edited manifest version is overwritten by the next release, and a drift check warns.
- A repo adopts the record with a migrate command that seeds each entry's version and `at` from the package's last tag, so pending commits stay pending. A package whose tag can't be found or reached is seeded by hand. Backfill still reads tags, since it rebuilds releases from before the record existed.
- Reconciling against registries ([#548](https://github.com/goosewobbler/releasekit/issues/548)) compares the record with what was published, which also finds a failed release that was never retried.
- Supersedes #958's decisions on finding the version source in tags and warning about untagged packages.
