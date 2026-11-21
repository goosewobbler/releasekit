# 9. One versioning model: packages, coupled by groups

Date: 2026-11-20

## Status

Accepted. Implementation tracked in [#1066](https://github.com/goosewobbler/releasekit/issues/1066) and [#958](https://github.com/goosewobbler/releasekit/issues/958).

## Context

The version step has four strategies, each with its own code path: sync, single, async and group. The `sync` setting's description calls `sync: true` an implicit fixed group of every package, but sync has its own code path for two reasons:

- consumers such as standing PRs rely on its outputs: a shared tag, one changelog for the repo and the root manifest bump;
- it takes its version from one package, because packages' tags and manifests can disagree.

[ADR 0008](./0008-versions-live-in-a-version-record.md) removes the second reason: every package's version comes from the record.

## Decision

**One code path versions every package. A package is versioned on its own unless a group couples it to others.**

- A `fixed` or `linked` group shares one version: the highest of its members' versions, raised by the largest bump any member's commits call for. An `independent` group keeps its members' own versions and only releases them together.
- The four strategies map onto this model, and the version output's `strategy` label keeps three of their names:

| Config | Today | Under this ADR | `strategy` |
|---|---|---|---|
| `sync: true` | sync strategy | one `fixed` group of every package, counting commits anywhere in the repo, with sync's outputs | `sync` |
| `version.groups` set | group strategy | the declared groups | `group` |
| neither, several packages | async strategy | each package on its own | `async` |
| neither, one package | single strategy | that package on its own | `async` |

## Consequences

- Four code paths become one.
- `sync: true` becomes the implicit fixed group of every package that its description already claims.
- The single strategy goes. A one-package repo with `sync: false` reports `async` instead of `single`.
- `mainPackage` no longer chooses where sync's version comes from.
- [#1066](https://github.com/goosewobbler/releasekit/issues/1066) specifies the outputs each kind of release keeps and how old manifests are read.
