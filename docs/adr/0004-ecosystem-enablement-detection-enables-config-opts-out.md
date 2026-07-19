# 4. Ecosystem enablement: detection enables, config opts out

Date: 2026-07-19

## Status

Accepted. Implementation tracked in [#554](https://github.com/goosewobbler/releasekit/issues/554).

## Context

ReleaseKit's pipeline is registry-agnostic and spans multiple ecosystems (npm, crates.io, pub.dev today; more planned). Enablement had grown asymmetric: npm published by default while crates.io and pub.dev were opt-in (`publish.*.enabled: false`), and npm alone had no version-handling toggle at all — the other two did.

That asymmetry is a footgun that worsens with every ecosystem added. A contributor wiring a new adapter has to decide, per ecosystem, whether it versions and whether it publishes by default, and a user reading the config finds the same key means different things in different ecosystems. A detected-but-off ecosystem also fails silently — the packages are simply never published, with no error.

The question this settles: when ReleaseKit detects an ecosystem, what does it do with it by default?

## Decision

**No ecosystem is special — detection enables, config opts out.** Every ecosystem ReleaseKit detects is versioned, and (where publishing is configured and authenticated) published, by default. Explicit config is only ever an *opt-out*.

- `publish.<eco>.enabled` defaults `true` for every ecosystem (was `false` for crates.io/pub.dev).
- `version.<eco>.enabled` exists for every ecosystem (npm gained `version.npm.enabled`) and defaults `true`.
- The two opt-outs are kept deliberately separate because they express different real needs: `version.<eco>.enabled: false` means "don't touch this ecosystem's manifests at all" (e.g. a vendored crate, or Rust versioning handled by release-plz); `publish.<eco>.enabled: false` means "version and tag this ecosystem, but publish it elsewhere".

Default-on is safe because the pipeline already fails safe *structurally*, independent of the toggle: an enabled registry that discovers zero targets no-ops, and publishing without credentials fails or skips at the auth check. The toggle is an opt-out, not a safety mechanism.

## Consequences

- One symmetric mental model that scales: a newly-added ecosystem adapter is on-by-default with no per-ecosystem special-casing, and "detected" and "released" no longer diverge silently.
- Flipping the crates.io/pub.dev publish defaults from `false` to `true` is a behaviour change — a pre-existing config relying on the old opt-in would start publishing. Acceptable here (pre-1.0, single maintainer, configs updated alongside the change); a `!`/`BREAKING CHANGE` release note carries it.
- Two independent per-ecosystem opt-outs are more config surface than one, but collapsing them would conflate "don't manage this ecosystem" with "manage but don't publish" — two outcomes users genuinely need to select between.
