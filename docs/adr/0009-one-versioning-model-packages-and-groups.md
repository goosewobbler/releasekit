# 9. One versioning model: packages, coupled by groups

Date: 2026-11-20

## Status

Accepted. Amends [0003](./0003-optional-change-file-input.md): the "strategy machinery" change files feed is now this one model. Implementation tracked in [#1066](https://github.com/goosewobbler/releasekit/issues/1066) and [#958](https://github.com/goosewobbler/releasekit/issues/958).

## Context

The version step has four strategies, each with its own code path: sync, single, async and group. The `sync` setting's description calls `sync: true` an implicit fixed group of every package, but sync has its own code path for two reasons:

- consumers such as standing PRs rely on its outputs: a shared tag and changelog (per-package ones with `packageSpecificTags`) and the root manifest bump;
- it takes its version from one package, because packages' tags and manifests can disagree.

[ADR 0008](./0008-versions-live-in-a-version-record.md) removes the second reason: every package's version comes from the record.

## Decision

**One code path versions every package. A package is versioned on its own unless a group couples it to others.**

- A `fixed` group releases every member at one version: the highest of its members' versions, raised by the largest bump any member's commits call for, and never below any member's own next version. A `linked` group works the same way but releases only its changed members. An `independent` group releases its changed members on their own versions, and targeting one member pulls in the whole group.
- The four strategies map onto this model, and the version output's `strategy` label keeps three of their names:

| Config | Today | Under this ADR | `strategy` |
|---|---|---|---|
| `sync: true` (the default) or `--sync`, with or without `version.groups` | sync strategy | one `fixed` group of every package, counting commits anywhere in the repo, with sync's outputs | `sync` |
| `sync: false`, `version.groups` set | group strategy | the declared groups, and every other package on its own | `group` |
| `sync: false`, no groups, a run that resolves several packages | async strategy | each package on its own | `async` |
| `sync: false`, no groups, a run that resolves one package | single strategy | that package on its own | `async` |

## Consequences

- Four code paths become one.
- `sync: true` becomes the implicit fixed group of every package that its description already claims, with a repo-wide commit scope and sync's outputs, which a declared fixed group doesn't have. It still takes precedence over `version.groups`.
- The single strategy goes. A run that resolves one package with `sync: false` and no groups reports `async` instead of `single`, and [#1066](https://github.com/goosewobbler/releasekit/issues/1066) lists its other changes, such as its default commit message and what `mainPackage` means there.
- `mainPackage` no longer chooses where sync's version comes from.
- [#1066](https://github.com/goosewobbler/releasekit/issues/1066) specifies the outputs each kind of release keeps and how old manifests are read.
