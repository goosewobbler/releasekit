# 9. One versioning model: packages, coupled by groups

Date: 2026-11-20

## Status

Accepted. Implementation tracked in [#1066](https://github.com/goosewobbler/releasekit/issues/1066) and [#958](https://github.com/goosewobbler/releasekit/issues/958).

## Context

The version step has four strategies, sync, single, async and group, each with its own code path. `sync: true` is described as one implicit fixed group of every package, but it stays off the group code for two reasons. Standing PRs and other consumers depend on its outputs: one shared tag, one repo changelog, the root manifest bump and `strategy: 'sync'`. And it takes its version from a single package, because packages' tags and manifests could disagree.

With versions in the record ([ADR 0008](./0008-versions-live-in-a-version-record.md)), a `sync: true` group takes its version from its members' entries, as a fixed group does, so the second reason is gone. The first is kept on purpose: the group code produces sync's outputs for a `sync: true` group.

## Decision

**Every package is versioned on its own line unless a group couples it. There is one code path, not four strategies; the version output's `strategy` stays as a label for the release's shape.**

- Groups couple packages as they do now: `fixed` and `linked` share a version, and `independent` keeps members on their own lines but releases them together. A `fixed` or `linked` group's version is the highest of its members' entries, bumped once.
- `sync: true` is one `fixed` group of every package. It keeps sync's repo-wide commit scope and its outputs (one shared tag by default, one repo changelog, the root manifest bump).
- Single mode goes: a run that resolves one package with `sync: false` versions it as one package on its own line.

## Consequences

- One code path works out every version.
- `sync: true` really is a `fixed` group, with a repo-wide scope and sync's outputs, and its description says so; `mainPackage` no longer chooses where its version comes from; what it still names is specified in [#1066](https://github.com/goosewobbler/releasekit/issues/1066).
- A run that resolves one package with `sync: false` reports a different `strategy` in its version output; [#1066](https://github.com/goosewobbler/releasekit/issues/1066) specifies that and the run's other changes, how `sync: true` combines with declared groups, and how old standing-PR manifests are read.
