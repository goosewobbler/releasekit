# 9. One versioning model: packages, coupled by groups

Date: 2026-11-20

## Status

Accepted. Implementation tracked in [#1066](https://github.com/goosewobbler/releasekit/issues/1066) and [#958](https://github.com/goosewobbler/releasekit/issues/958).

## Context

The version step has four strategies, sync, single, async and group, each with its own code path. `sync: true` is described as one implicit fixed group of every package, but it stays off the group code: it takes its version from a single package, because packages' tags and manifests could disagree.

With versions in the record ([ADR 0008](./0008-versions-live-in-a-version-record.md)), every package of a sync release holds the same version, so that reason is gone.

## Decision

**Every package is versioned on its own line unless a group couples it. There are no strategies.**

- Groups couple packages as they do now: `fixed`, `linked` and `independent`.
- `sync: true` is one `fixed` group of every package. Its outputs don't change.
- Single mode goes.

## Consequences

- One code path works out every version.
- `sync: true` becomes what its description says.
- Which outputs each kind of release keeps, and how old standing-PR manifests are read, are specified in #1066.
