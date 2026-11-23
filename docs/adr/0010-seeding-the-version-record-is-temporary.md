# 10. Seeding the version record is temporary

Date: 2026-11-23

## Status

Accepted. Amends [0008](./0008-versions-live-in-a-version-record.md): seeding from tags runs only until each consumer has a record, and records on different branches aren't reconciled automatically. Implementation tracked in [#1066](https://github.com/goosewobbler/releasekit/issues/1066) and [#958](https://github.com/goosewobbler/releasekit/issues/958).

## Context

0008 seeds each package without an entry from today's tag search on every version run, so a package that joins with existing releases continues from its tags. That keeps the tag search, and the settings that work around it (`baselineTagTemplate`, `strictReachable`, `mismatchStrategy`), for good, though 0008 exists to remove them.

0008 also has merging a maintenance branch reconcile the two records, with a rule per entry. No consumer has a maintenance branch.

ReleaseKit is pre-1.0 and has three consumers: this repo, zubridge and wdio-desktop-mobile.

## Decision

- **Seeding runs until every consumer has released with a record, then goes**, with the version step's tag search and the settings that work around it. A package that joins later with existing releases gets a hand-written entry.
- **Records on different branches aren't reconciled automatically.** A conflict in the record when a branch merges is resolved by hand; the version step's ancestor check fails on an entry whose commit isn't in `HEAD`'s history.

## Consequences

- No tag is read to compute a version or range once seeding goes. Backfill keeps its own tag reading.
- Adding a package with existing releases, or merging a maintenance branch, takes a hand edit of the record.
- 0008's other decisions stand.
