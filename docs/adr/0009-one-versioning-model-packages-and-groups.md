# 9. One versioning model: packages, coupled by groups

Date: 2026-11-20

## Status

Accepted. Implementation tracked in [#1066](https://github.com/goosewobbler/releasekit/issues/1066) and [#958](https://github.com/goosewobbler/releasekit/issues/958).

## Context

The version step has four strategies, sync, single, async and group, each with its own code path. `sync: true` is described as an implicit fixed group of every package, but it stays off the group code for two reasons: consumers such as standing PRs depend on its outputs, and it takes its version from a single package because packages' tags and manifests could disagree. [ADR 0008](./0008-versions-live-in-a-version-record.md) removes the second reason.

## Decision

**One code path versions every package. A package moves on its own line unless a group couples it.**

- `fixed` and `linked` groups share a version: the highest of their members' versions, bumped at most once. `independent` groups keep their members' own versions and only release them together.
- `sync: true` is a `fixed` group of every package that counts commits across the whole repo and keeps sync's outputs.
- Single mode goes.

## Consequences

- Four code paths become one, and `sync: true` does what its description says.
- The version output's `strategy` becomes a label for the release's shape. A one-package run with `sync: false` reports `async`, not `single`.
- `mainPackage` no longer chooses where sync's version comes from.
- [#1066](https://github.com/goosewobbler/releasekit/issues/1066) specifies the outputs each kind of release keeps and how old manifests are read.
