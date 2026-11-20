# 8. Versions live in a committed version record, not in tags

Date: 2026-11-20

## Status

Accepted. Implementation tracked in [#958](https://github.com/goosewobbler/releasekit/issues/958).

## Context

ReleaseKit works out a package's current version by searching git tags. Tag names come from configurable templates. Tags can be moved off the branch, missing from a shallow clone, sanitized, or left over from earlier tooling. When the search finds nothing, it falls back to the manifest or to another release's tag; when a tag and the manifest disagree, `mismatchStrategy` picks one. Baseline tags (`baselineTagTemplate`) exist to work around moved tags.

Each versioning strategy implements this search differently. A draft ADR that tried to define one rule for it ([#1060](https://github.com/goosewobbler/releasekit/pull/1060)) didn't converge over twenty review rounds: each round found another case where tag naming, reachability or the manifest comparison changed the answer.

The planned ecosystems make it harder. Tag-only ecosystems and Go have no version in any manifest, and Go needs tags prefixed with the module's path. release-please avoids the search by keeping versions in a committed manifest file.

## Decision

**A committed version record is the only source of a package's current version. Manifests and tags are outputs.**

- The record is `releasekit.versions.json` at the repo root. It maps each package's path to its version, and only release commits write it.
- The version step reads each package's current version from the record and writes the new version to the record, the manifests and the tags.
- A package's last release is the last commit that changed its entry. Its bump, its changelog and change detection count commits after that one. The entry's history gives its last stable version.
- A package with no entry has never been released by ReleaseKit. It starts from its manifest version, else `0.1.0`, and every commit in its paths counts.
- Tags are created for consumers and GitHub Releases, but never read to work out a version.
- Editing an entry by hand declares that version released at the editing commit, as creating a tag by hand does today. A bump is still requested with labels or `--bump`, not by editing the record.

## Consequences

- No version is looked up in tags, so tag templates, moved tags and tags missing from a shallow clone stop affecting versions. History back to each package's last release still has to be fetched.
- The manifest-against-tag comparison (`mismatchStrategy`) and baseline tags (`baselineTagTemplate`) go.
- Every ecosystem works the same way: those with no version in a manifest, a package with more than one manifest, and configs that don't write a manifest's version.
- Tag names still have to be unique ([#1045](https://github.com/goosewobbler/releasekit/issues/1045)).
- A version appears in two places, the record and the manifest. The record wins; a hand-edited manifest version is overwritten by the next release, and a drift check warns.
- A repo adopts the record right after a release, seeded with each package's released version, so the adopting commit is a valid last release. Backfill still reads tags, since it rebuilds releases from before the record existed.
- Supersedes #958's decisions on finding the version source in tags and warning about untagged packages.
