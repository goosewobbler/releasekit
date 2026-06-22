# CONTEXT — domain glossary

Shared *domain* vocabulary for releasekit. (Architecture terms — module / seam / deep / shallow — live in the deepening plans; this file names the problem domain.)

## Versioning baselines — three distinct notions, kept separate

Conflating these is the historical source of the `fix(version)` bug cluster (#330/#334/#339/#348). They are not one concept.

- **Version source (A)** — the semver a package is bumped *from*: its own tag → manifest version → `0.1.0`, with tag/manifest mismatch detection. Owned by `getBestVersionSource`. Answers *"bump from what?"*.
- **Changelog floor / per-package floor (B)** — the `<tag>..HEAD` revision range a package's *own* changelog entries are collected from. On prerelease→stable **graduation** the floor is the last *stable* tag (aggregate since last stable), which can differ from the version source's tag.
- **Shared floor / repo-level floor (C)** — the range bounding *project-wide* ("shared") entries (CI, infra, shared-package changes) so an untagged package doesn't flood them with full history. Computed once per run from the nearest reachable tag.

**BaselineResolver** — per-run module owning **B + C** (not A): reachability, graduation-aware floor, dual-tag handling, and the shared-floor cache. Receives already-discovered tag facts; returns `{ revisionRange, sharedRevisionRange, previousVersion, baselineUnreachable }` per package.

## Tags

- **Consumer tag** — user-facing release tag from `tagTemplate` (e.g. `v1.2.3`); drives GitHub Releases.
- **Baseline (marker) tag** — internal tag from `baselineTagTemplate` (e.g. `release/v1.2.3`); stays on branch history for range math when the consumer tag is force-moved off it. `previousVersion` is the floor tag display-stripped back to consumer form.
- **baselineUnreachable** — the configured floor ref exists but isn't reachable from HEAD (shallow clone / unpushed), or is a manifest-fallback synthetic tag; the range collapses to full history and `previousVersion` is suppressed.

## Release taxonomy (feature: grouped / prerequisite releases)

- **Explicit group** — a declared coordination invariant over related packages: `fixed` (shared version, all move) · `linked` (shared version, changed-only) · `independent` (own version lines, changed-only, atomic).
- **Prerequisite** — *derived* from the dependency graph at release time; keeps its own commit-driven bump; pulled in only if changed; dependency-ordered.
- **Selection** — orthogonal *"what to act on now"* (scope labels / checkboxes / CLI). Under this taxonomy, scope labels revert to pure selection — they are not the home for co-release coupling.

## Forge — the hosting platform, distinct from git

- **Forge** — the *remote* hosting platform's collaboration API: pull requests, marker comments, labels, commit statuses, releases. GitHub is the only forge today; GitLab/Bitbucket would be additional **adapters** behind the same `Forge` interface (`@releasekit/forge`: `Forge` interface + `GitHubForge` octokit adapter + in-memory fake). Returns plain data — never leaks Octokit types — so a second forge is a new adapter with zero caller changes.
- **Not** the **git** layer — `git` is the *local* CLI (tags, log, commit, push, status; no token, no PR concept); a forge is the *server-side API* over HTTP with a token. A release run uses both at once.

## Marker codec — machine state behind its own marker

The AGENTS.md invariant ("machine state embedded in comments uses its own marker line — never parse the human-facing prose") is owned by `@releasekit/core`'s marker codec, in two shapes:

- **`markerData<T>`** — a single typed datum on one `<!-- open payload -->` line (manifest base64 blob; failure-report `status`/`data` fields). `encode(T)→line`, `decode(body)→T|null` by linear delimiter slicing (no backtracking regex → no ReDoS).
- **`markerRegion`** (`wrapMarkerRegion`/`extractMarkerRegion`) — a span of editable content between a distinct open/close marker pair (the editable release-notes region; the future checkbox-selection block). `notes-region` is an adapter over it.

The *find + idempotent upsert* of the whole comment is a separate concern, owned by the **[[forge]]** (`findComment`/`upsertMarkerComment`). Prose-only bot comments (preview, gate-notify) carry no machine state and just upsert a marker-keyed body.
