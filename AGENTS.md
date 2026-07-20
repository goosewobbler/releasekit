# AGENTS.md

Releases run in standing-PR mode with sync versioning; the standing release PR lives on `release/next`.

## Architecture invariants

Violating these breaks releases.

- **Three-stage pipeline** version → notes → publish. `VersionOutput` (`packages/core/src/types.ts`) is the JSON contract between stages **and** is persisted in standing-PR manifests — new fields must be optional; consumers must tolerate their absence (old manifests live in open PRs).
- **Roll-forward** version bumps land on `main` before publishing. A failed publish is never recovered by reverting version commits — publishes are idempotent (already-published versions skipped; tags/Releases created only after a clean publish) and are retried or superseded next release.
- **Release-commit prefix** subjects starting with `chore: release ` match `release.ci.skipPatterns` and suppress standing-PR update runs. Keep the prefix on release commits; nothing else may use it.
- **`[skip ci]` asymmetry** the direct-release commit on `main` (`version.commitMessage`) includes it to stop CI loops — leave it. The standing-PR branch's prep commit must NOT: a squash merge inherits its message, and `[skip ci]` on `main` would suppress the publish workflow.
- **Marker comments** every bot comment is keyed by a distinct HTML marker and posted idempotently (update-in-place). Machine state uses its own marker line — never parse the human prose.
- **Workflow `if` guards can't read config** label names in workflow guards are hardcoded defaults; in-step checks against `releasekit.config.json` are authoritative.

## Generated — never hand-edit (CI's `schema:check` fails on drift)

- `releasekit.schema.json` ← Zod schema `packages/config/src/schema.ts` → `pnpm schema:gen`
- `docs/configuration.md` ← `pnpm docs:config`

Design decisions are recorded in `docs/adr/` — check there before reworking a load-bearing choice.
