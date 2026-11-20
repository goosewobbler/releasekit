# CONTEXT — domain glossary

Shared *domain* vocabulary for releasekit. (Architecture terms — module / seam / deep / shallow — live in the deepening plans; this file names the problem domain.)

## Versioning baselines — three distinct notions, kept separate

Conflating these is the historical source of the `fix(version)` bug cluster (#330/#334/#339/#348). They are not one concept.

- **Version source (A)** — the semver a package is bumped *from*: its own tag → manifest version → `0.1.0`, with tag/manifest mismatch detection. Owned by `getBestVersionSource`. Answers *"bump from what?"*. ADR 0008 restates it per version unit (own tag series, then manifest, then `0.1.0`; never a tag outside that series, and a `fixed` or `linked` group member's baseline takes the higher of tag and manifest); the strategies don't all follow it until #958.
- **Changelog floor / per-package floor (B)** — the `<tag>..HEAD` revision range a package's *own* changelog entries, and the shared-package entries its notes list, are collected from. On prerelease→stable **graduation** the floor is the last *stable* tag (aggregate since last stable), which can differ from the version source's tag.
- **Shared floor / repo-level floor (C)** — the range bounding the run's *project-wide* ("shared") entries (CI, infra, shared-package changes) in the standing PR and the root changelog, so an untagged package doesn't flood them with full history. Under `sharedChangelogFloor: union` (the default) it's the oldest releasing package's baseline; under `sinceLastRelease`, the nearest reachable tag.

**BaselineResolver** — per-run module owning **B + C** (not A): reachability, graduation-aware floor, dual-tag handling, and the shared-floor cache. Receives already-discovered tag facts; returns `{ revisionRange, sharedRevisionRange, previousVersion, baselineUnreachable }` per package.

## Tags

- **Consumer tag** — user-facing release tag from `tagTemplate` (e.g. `v1.2.3`); drives GitHub Releases.
- **Own tag series** — per ADR 0008, the series a version unit's own tags are named in, consumer or (with `baselineTagTemplate`) baseline: the repo's `v1.2.3` (or `release/v1.2.3`) when the template doesn't name the package, or `pkg@v1.2.3` (or `release/pkg@v1.2.3`) when it does; with package-named tags, a sync unit's is its `mainPackage`'s.
- **Baseline (marker) tag** — internal tag from `baselineTagTemplate` (e.g. `release/v1.2.3`); stays on branch history for range math when the consumer tag is force-moved off it. `previousVersion` is the floor tag display-stripped back to consumer form (per ADR 0008, #958 limits it to the unit's own tags).
- **baselineUnreachable** — the configured floor ref exists but isn't reachable from HEAD (shallow clone / unpushed), or is a manifest-fallback synthetic tag; the range collapses to full history and `previousVersion` is suppressed.

## Release taxonomy (feature: grouped / prerequisite releases)

- **Explicit group** — a declared coordination invariant over related packages: `fixed` (shared version, all move) · `linked` (shared version, changed-only) · `independent` (own version lines, changed-only, atomic).
- **Release unit** — a primary package (`primaryPackages`) with its group-mates and the internal dependencies it releases with; used by the standing-PR selection list.
- **Version unit** — what has its own version source (not a *release unit*, the `primaryPackages` selection unit): the whole repo in sync mode, otherwise each package. A `fixed` or `linked` group's members are separate units; the group sets their shared version from all of them.
- **Carried package** — a package released without setting its own version: a fixed-group member with no change of its own (its own version still counts toward the group's), and every package of a sync release (only the sync unit has a version source, so its packages' versions count toward nothing).
- **Prerequisite** — *derived* from the dependency graph at release time; keeps its own commit-driven bump; pulled in only if changed; dependency-ordered.
- **Selection** — orthogonal *"what to act on now"* (scope labels / checkboxes / CLI). Under this taxonomy, scope labels revert to pure selection — they are not the home for co-release coupling.
- **Selection region** — the standing-PR ad-hoc selection surface: a GitHub task-list in the PR body (one ticked row per changed package). Unticking holds a package back; the engine drops it via the `exclude` knob (never bumped → no orphan version on `main`), and the choice round-trips by marker slicing so it survives regeneration. A `markerRegion` adapter (see below). Sync releases are atomic and have no selection rows; lockstep group members can't be held back individually.

## Forge — the hosting platform, distinct from git

- **Forge** — the *remote* hosting platform's collaboration API: pull requests, marker comments, labels, commit statuses, releases. GitHub is the only forge today; GitLab/Bitbucket would be additional **adapters** behind the same `Forge` interface (`@releasekit/forge`: `Forge` interface + `GitHubForge` octokit adapter + in-memory fake). Returns plain data — never leaks Octokit types — so a second forge is a new adapter with zero caller changes.
- **Not** the **git** layer — `git` is the *local* CLI (tags, log, commit, push, status; no token, no PR concept); a forge is the *server-side API* over HTTP with a token. A release run uses both at once.

## Marker codec — machine state behind its own marker

The AGENTS.md invariant ("machine state embedded in comments uses its own marker line — never parse the human-facing prose") is owned by `@releasekit/core`'s marker codec, in two shapes:

- **`markerData<T>`** — a single typed datum on one `<!-- open payload -->` line (manifest base64 blob; failure-report `status`/`data` fields). `encode(T)→line`, `decode(body)→T|null` by linear delimiter slicing (no backtracking regex → no ReDoS).
- **`markerRegion`** (`wrapMarkerRegion`/`extractMarkerRegion`) — a span of editable content between a distinct open/close marker pair. Two adapters today: `notes-region` (editable release notes) and `selection-region` (the [[Selection region]] task-list; per-row `<!-- rk-sel:NAME -->` identity markers, with the `[x]`/`[ ]` glyph the human toggles).

The *find + idempotent upsert* of the whole comment is a separate concern, owned by the **[[forge]]** (`findComment`/`upsertMarkerComment`). Prose-only bot comments (preview, gate-notify) just upsert a marker-keyed body, except that after a release `markStaleAfterRelease` edits a preview in place, adding a `<!-- releasekit-preview-stale -->` line and notice that the next upsert drops.

## Changelog rendering

- **Changelog surface** — anywhere changelog entries are rendered: `CHANGELOG.md`, per-version notes files, GitHub release bodies, standing-PR rows and the preview. **Release surfaces** are the subset LLM output may reach (ADR 0007): release bodies, notes files and the standing PR's notes region.
- **Section** — a labelled group of entries. Breaking comes first, then either LLM categories (when `categorize` ran) or type labels in Keep a Changelog order followed by "Dependencies & version bumps" for `deps`/`deps-dev` entries.
- **Entry line** — one entry rendered as a Markdown list item: optional bold scope or lead-in, description, refs. The same shape on every surface; a breaking entry is marked by its section, not by a prefix.

## Publish authorization

- **Publish phase** — where a publish is asked for: **pre-merge** (`standing-pr merge`), **post-merge** (the merged standing PR's publish, whether its merge, a retry or a dispatch started it), **draft** (`release --from-draft`) and **direct** (`release` from the pushed commit). Every phase asks one module (`authorizePublish`), which reads each PR fact from the **[[forge]]**, never the triggering event.
- **Refusal report** — the failure report a refused release posts on its PR or issue, with recovery for its phase. Naming the wrong kind of PR or issue refuses without one.
