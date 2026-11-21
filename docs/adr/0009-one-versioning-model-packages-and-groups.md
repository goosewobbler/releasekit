# 9. One versioning model: packages, coupled by groups

Date: 2026-11-20

## Status

Accepted. Amends [0003](./0003-optional-change-file-input.md): the "strategy machinery" change files feed becomes this one model. Implementation tracked in [#1066](https://github.com/goosewobbler/releasekit/issues/1066) and [#958](https://github.com/goosewobbler/releasekit/issues/958).

## Context

The version step has four strategies with separate code paths: sync, single, async and group. `sync: true` is described as an implicit fixed group of every package, but it has its own code path because:

- consumers such as standing PRs rely on its outputs: a shared tag and changelog (per-package ones with `packageSpecificTags`) and the root manifests' bump;
- it takes its version from one package, since packages' tags and manifests can disagree.

[ADR 0008](./0008-versions-live-in-a-version-record.md) removes the second reason: every version comes from the record.

## Decision

**One code path versions every package. A package is versioned on its own unless a group couples it to others.**

- Groups work as they do now:
  - `fixed`: every member releases at one version, the highest of the members' recorded versions raised by the largest bump any member calls for, and never below a member's own next version.
  - `linked`: the same, but only changed members release.
  - `independent`: changed members release together, each at its own version.

  A member with no entry joins at the group's version, and a group with no entries starts from its members' manifests, as a new package does. Targeting a member of a `fixed` or `independent` group pulls in the whole group.
- The four strategies map onto this model, and the version output's `strategy` label keeps three of their names:

| Config | Today | Under this ADR | `strategy` |
|---|---|---|---|
| `sync: true` (the default) or `--sync`, with or without `version.groups` | sync strategy | one `fixed` group of every package, counting commits anywhere in the repo, with sync's outputs | `sync` |
| `sync: false`, non-empty `version.groups` | group strategy | the declared groups, and every other package on its own | `group` |
| `sync: false`, no groups, several packages resolved | async strategy | each package on its own | `async` |
| `sync: false`, no groups, one package resolved | single strategy | that package on its own | `async` |

## Consequences

- `sync: true` becomes the implicit fixed group its description claims, with a repo-wide commit scope and sync's outputs, which a declared fixed group doesn't have. It still takes precedence over `version.groups`.
- The single strategy goes: a one-package run with `sync: false` and no groups reports `async`, not `single`.
- `mainPackage` no longer chooses sync's version, but still supplies its repository URL and, when `packageSpecificTags` is off, names its changelog.
- [#1066](https://github.com/goosewobbler/releasekit/issues/1066) specifies the outputs each kind of release keeps, the single strategy's other changes, and how old manifests are read.
