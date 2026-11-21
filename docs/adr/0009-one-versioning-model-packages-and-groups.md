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

- Groups keep today's behaviour. A `fixed` group releases every member at one shared version, a `linked` group releases only its changed members at that version, and an `independent` group releases its changed members together at their own versions. [#1066](https://github.com/goosewobbler/releasekit/issues/1066) specifies how the shared version is computed.
- The `single` strategy is dropped. Today's strategies map onto this model as follows:

| Config | Today | Under this ADR | `strategy` |
|---|---|---|---|
| `sync: true` (the default) or `--sync`, with or without `version.groups` | sync strategy | one `fixed` group of every package, counting commits anywhere in the repo, with sync's outputs | `sync` |
| `sync: false`, non-empty `version.groups` | group strategy | the declared groups, and every other package on its own | `group` |
| `sync: false`, no groups, several packages resolved | async strategy | each package on its own | `async` |
| `sync: false`, no groups, one package resolved | single strategy | that package on its own | `async` |

## Consequences

- `sync: true` now works as its description says: a fixed group of every package. Unlike a fixed group in `version.groups`, it counts commits anywhere in the repo and keeps the outputs of today's sync releases, and it still overrides `version.groups`.
- `mainPackage` no longer decides the shared version of a `sync: true` release. It still provides that release's repository URL and, without `packageSpecificTags`, the name of its changelog.
- [#1066](https://github.com/goosewobbler/releasekit/issues/1066) specifies the outputs each kind of release keeps, the single strategy's other changes, and how old manifests are read.
