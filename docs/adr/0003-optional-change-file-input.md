# 3. Change files are supported as an optional input, in changesets format

Date: 2026-07-19

## Status

Accepted. Implementation tracked in [#545](https://github.com/goosewobbler/releasekit/issues/545).

## Context

ReleaseKit derives version bumps and changelog content from Conventional Commits. A large and mobile population of monorepo teams instead relies on **change files** — human-authored change-intent files committed alongside a PR — via [changesets](https://github.com/changesets/changesets). Changesets' most-cited strength is "the pause": explicit, reviewable release intent decoupled from commit history.

Two competitive facts make this a gap worth closing:

- Teams evaluating a migration away from changesets (its prerelease handling is a long-standing weak spot, and its maintenance is contested) will not consider releasekit at all if it cannot consume their existing change files.
- **sampo** — the closest multi-registry competitor — is changesets-format-native and courts exactly these migrators. Without change-file support, releasekit cedes them by default.

knope demonstrates that Conventional Commits and change files can be unified into a single change stream rather than being mutually exclusive.

## Decision

ReleaseKit adds change files as an **optional** input. Conventional Commits remain the default; nothing about existing behaviour changes.

- **Format: the changesets `.changeset/*.md` grammar, verbatim**, parsed as a superset (also accepting `ecosystem/name` canonical-ID keys, which additionally covers sampo migrators). A migrating repo's *pending* changesets are consumed in place with zero file moves. Non-parseable files and `README.md` are skipped with a warning (every changesets repo has `.changeset/README.md`).
- **Aggregation: a unified change stream, max-rule.** A change file is just another producer of the same `Change` records commits produce. Two modes: `additive` (default — files and commits combine) and `only` (pure changesets emulation).
- Group / prerequisite / strategy machinery runs after aggregation, unchanged — that layer is where releasekit already exceeds sampo, and change files compose with it for free.
- File prose enters the notes pipeline **verbatim by default** (human-authored user-facing prose is the entire point; LLM rewrite is opt-in).
- A `releasekit migrate --from-changesets` command maps `config.json` (fixed/linked/ignore/baseBranch/access) and defaults new configs to `mode: "only"` for day-one behavioural parity, with `additive` as the later upsell. Mid-prerelease migrations (`pre.json` present) are refused with guidance rather than half-ported.

## Consequences

- releasekit becomes a viable migration target for changesets and sampo users without abandoning its commit-first identity.
- The `VersionOutput` contract gains an optional `changeFiles` field; per the manifest-compatibility invariant, it must be optional so older manifests in open PRs tolerate its absence.
- A second change-intent source means two ways to express the same bump; the max-rule and the `additive`/`only` modes keep the resolution predictable, and no per-package "file wins over commit" special-casing is introduced (it produces unexplainable outcomes).
- The same parsing primitive yields an Action-side "change present?" check (marker comment + status or dismissable review) that matches sampo's hosted-bot gate with no hosted infrastructure.
