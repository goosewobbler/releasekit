# 9. One versioning model: packages, coupled by groups

Date: 2026-11-20

## Status

Accepted. Amends [0003](./0003-optional-change-file-input.md): the "strategy machinery" change files feed becomes this one model. Implementation tracked in [#1066](https://github.com/goosewobbler/releasekit/issues/1066) and [#958](https://github.com/goosewobbler/releasekit/issues/958).

## Context

The version step has four strategies, each with its own code path: sync, single, async and group. The `sync` setting's description says `sync: true` is an implicit fixed group of every package, but the sync strategy doesn't use the group code, for two reasons:

- standing PRs and other consumers rely on what the sync strategy produces: one tag and one changelog for the whole repo (one per package with `packageSpecificTags`), and a version bump in the root manifests;
- the sync strategy reads its version from one package, because packages' tags and manifests can disagree.

[ADR 0008](./0008-versions-live-in-a-version-record.md) removes the second reason: every package's version comes from the record.

## Decision

**One code path versions every package. A package is versioned on its own unless a group couples it to others.**

- Groups keep today's behaviour. A `fixed` group releases every member at one shared version, a `linked` group releases only its changed members at that version, and an `independent` group releases its changed members together at their own versions. [#1066](https://github.com/goosewobbler/releasekit/issues/1066) specifies how the shared version is computed.
- The `single` strategy is dropped. Today's strategies map onto this model as follows:

| Config | Today | Under this ADR | `strategy` |
|---|---|---|---|
| `sync: true` (the default) or `--sync`, with or without `version.groups` | sync strategy | one `fixed` group of every package, counting commits anywhere in the repo, with the sync strategy's tag, changelog and root manifest bump | `sync` |
| `sync: false`, non-empty `version.groups` | group strategy | the declared groups, and every other package on its own | `group` |
| `sync: false`, no groups, several packages resolved | async strategy | each package on its own | `async` |
| `sync: false`, no groups, one package resolved | single strategy | that package on its own | `async` |

## Consequences

- `sync: true` now works as its description says: a fixed group of every package. It differs from a fixed group in `version.groups` in two ways: it counts commits anywhere in the repo, and it produces the sync strategy's tag, changelog and root manifest bump. It still overrides `version.groups`.
- `mainPackage` no longer decides the shared version of a `sync: true` release. It still provides that release's repository URL and, without `packageSpecificTags`, the name of its changelog.
- [#1066](https://github.com/goosewobbler/releasekit/issues/1066) specifies the outputs each kind of release keeps, the single strategy's other changes, and how old manifests are read.
