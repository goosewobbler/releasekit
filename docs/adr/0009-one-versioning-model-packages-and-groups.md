# 9. One versioning model: packages, coupled by groups

Date: 2026-11-20

## Status

Accepted. Implementation tracked in [#958](https://github.com/goosewobbler/releasekit/issues/958).

## Context

The version step has four strategies, sync, single, async and group, each with its own code path. `sync: true` is described as one implicit fixed group of every package, but it takes its version from a single package instead of from its members. Single mode is chosen at run time from the number of packages.

Sync needed its own version source because packages' tags and manifests could disagree. With versions in the record ([ADR 0008](./0008-versions-live-in-a-version-record.md)), every package of a sync release holds the same version, so that reason is gone.

## Decision

**Every package is versioned on its own line unless a group couples it. There are no strategies.**

- Each package has its own entry in the version record.
- Groups couple packages as they do now: `fixed` (one version, every member moves), `linked` (one version, changed members move) and `independent` (own versions, released together). A `fixed` or `linked` group's version is the highest of its members' versions, bumped once.
- `sync: true` is one `fixed` group of every package, whose bump and changelog count commits anywhere in the repo, as sync does now.
- Single mode goes. A repo with one package has one package on its own line; releasing one package of several is a matter of selection (`version.packages`, targets).

## Consequences

- One code path works out every version, which #958 builds.
- `sync: true` becomes what its description says.
- `mainPackage` no longer chooses where a version comes from.
- A config that relies on single mode to release one package of a workspace selects it with `version.packages` instead.
- Supersedes #958's decision to keep sync as a separate unit with its own version source.
