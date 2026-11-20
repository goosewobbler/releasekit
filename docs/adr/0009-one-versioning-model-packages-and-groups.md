# 9. One versioning model: packages, coupled by groups

Date: 2026-11-20

## Status

Accepted. Implementation tracked in [#958](https://github.com/goosewobbler/releasekit/issues/958).

## Context

The version step has four strategies, sync, single, async and group, each with its own code path. `sync: true` is described as one implicit fixed group of every package, but it stays off the group code: standing PRs and other consumers depend on its outputs (one shared tag, one changelog for the repo, the root manifest bump, and `strategy: 'sync'` in the version output), and it takes its version from a single package because packages' tags and manifests could disagree. Single mode is chosen at run time from the number of packages.

With versions in the record ([ADR 0008](./0008-versions-live-in-a-version-record.md)), every package of a sync release holds the same version, so only the outputs still set sync apart.

## Decision

**Every package is versioned on its own line unless a group couples it. There are no strategies.**

- Each package has its own entry in the version record.
- Groups couple packages as they do now: `fixed` (one version, every member moves), `linked` (one version, changed members move) and `independent` (own versions, released together). A `fixed` or `linked` group's version is the highest of its members' versions, bumped once.
- `sync: true` is one `fixed` group of every package, whose bump and changelog count commits anywhere in the repo, as sync does now. Its outputs don't change: one shared tag with the default template, one changelog for the repo, the root manifest bump, and `strategy: 'sync'` in the version output.
- Single mode goes: a repo with one package has one package on its own line.
- The version output's `strategy` keeps describing the release's shape: `sync` for `sync: true`, `group` when groups are configured, else `async`. Nothing writes `single` any more, and consumers still accept it in old manifests.

## Consequences

- One code path works out every version, which #958 builds.
- `sync: true` becomes what its description says, and standing-PR manifests, old and new, still read as sync releases.
- `mainPackage` no longer chooses where a version comes from.
- A one-package repo's version output says `async` instead of `single`. An open standing PR's manifest is rewritten in the new form by its next update.
- Supersedes #958's decision to keep sync as a separate unit with its own version source.
