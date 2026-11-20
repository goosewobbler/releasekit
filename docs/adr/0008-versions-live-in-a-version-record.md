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

- The record is `releasekit.versions.json` at the repo root. Each package's entry, keyed by its path, holds its name, its version and `at`: the commit its release was computed at. A prerelease entry also holds the version and `at` of the package's last stable release, if it has one.
- During a release, the version step is the record's only writer. It reads each package's version from the record and writes the new version, with `at` set to the commit it ran on, to the record, the manifests and the tags.
- A package's bump, changelog and change detection count the commits in its paths after its `at`; a `sync: true` group counts commits anywhere in the repo after its newest `at` ([ADR 0009](./0009-one-versioning-model-packages-and-groups.md)). Commits that change the record (release commits, migration, hand edits) are never counted. A stable release after a prerelease series counts from its last stable `at`, or over its paths' whole history if it has never had a stable release.
- A package with no entry has never been released by ReleaseKit. It starts from its manifest version, else `0.1.0`, and every commit in its paths counts. In a `fixed` or `linked` group it takes the group's version, and its commits count from the group's newest `at`. A repo with version tags but no record fails the version step and points at the migrate command, rather than releasing everything as new.
- Anything that needs a package's past releases, such as bundled release notes or the project-wide changelog floor, reads them from the record's history, not from tags.
- Tags are created for consumers and GitHub Releases, but never read to work out a version. Creating a tag that already exists on a different commit fails the release, which stops a reverted record from releasing a version again.
- An entry whose path no longer holds a package moves to a package with no entry that has the same name, so a moved package keeps its history. Otherwise the next release removes the entry, with a warning. A package that's only excluded (private, skipped) keeps its entry.
- The version step needs the repo's full history and tags: a shallow clone, or an `at` that isn't an ancestor of `HEAD`, fails it.
- Editing an entry by hand declares that version released at the given `at`, as creating a tag by hand does today. A bump is still requested with labels or `--bump`.
- Recovery from a failed publish follows [docs/architecture.md](../architecture.md). Where the release commit already reached `main` (standing-PR and per-package modes), the record holds the failed package's version, so it's published by retrying that release; a later release that bumps the package again supersedes it. In direct batch mode nothing is pushed on failure, and a rerun recomputes the release.

## Consequences

- No version or release range is worked out from tags, so tag templates and moved tags stop mattering. History back to each package's `at` (its last stable `at`, for a graduation) still has to be fetched.
- Settings that exist for the tag lookup go: `mismatchStrategy`, `baselineTagTemplate` and `strictReachable`. A first release is one with no entry. Its overshoot check, which warns by default today, fails the run unless `allowFirstBump` is set. `packageSpecificTags` keeps choosing per-package tags, and with them sync's per-package publishing; bundled release notes no longer depend on it.
- Every ecosystem works the same way: those with no version in a manifest, a package with more than one manifest, and configs that don't write a manifest's version.
- A squash-merged standing PR can't mark commits that landed after its last update as released, because `at` is the commit the release was computed at.
- Tag names still have to be unique ([#1045](https://github.com/goosewobbler/releasekit/issues/1045)).
- A version appears in two places, the record and the manifest. The record wins; a hand-edited manifest version is overwritten by the next release, and a drift check warns.
- A repo adopts the record with a migrate command, its only other writer. It seeds each entry's version and `at` from the package's last tag (its baseline tag, where `baselineTagTemplate` is set), and a prerelease entry's last stable fields from its last stable tag, so pending commits stay pending. It refuses while a standing PR or an unpublished release draft is open, since those were computed without the record. A sync repo's entries are all seeded with its shared version. A package whose tag can't be found or reached is seeded by hand.
- A tag left by earlier tooling that a new version would reuse fails the version step until the tag is removed or the version moves past it. Backfill still reads tags, since it rebuilds releases from before the record existed.
- Reconciling against registries ([#548](https://github.com/goosewobbler/releasekit/issues/548)) compares the record with what was published, so it reports a version whose publish failed and was never retried.
- Supersedes #958's decisions on finding the version source in tags and warning about untagged packages.
