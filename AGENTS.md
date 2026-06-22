# AGENTS.md

AI context file for the ReleaseKit monorepo.

## Project Overview

ReleaseKit is release tooling for polyglot projects and monorepos: semantic versioning from Conventional Commits, changelog/release-notes generation (optionally LLM-enhanced), and publishing with git tags and GitHub Releases. Publish targets today are npm (JS/TS), crates.io (Rust), and pub.dev (Dart/Flutter); the pipeline is registry-agnostic and more ecosystems can be added. It ships as four npm packages, a unified `releasekit` CLI, and a composite GitHub Action.

This repo **dogfoods itself**: releases run in standing-PR mode with sync versioning (see `releasekit.config.json`). The standing release PR lives on `release/next`.

## Tech Stack

| Category | Technology |
|----------|------------|
| Language | TypeScript (strict, ESM — `"type": "module"`) |
| Runtime | Node.js ≥ 20 (CI examples use 24) |
| Package manager | pnpm with workspace catalogs |
| Monorepo | Turborepo + pnpm workspaces |
| Testing | Vitest (`test/unit`, `test/integration`), shell-based e2e harness |
| Linting | Biome (linter **and** formatter) + ESLint |
| Build | tsup |

## Monorepo Structure

```
packages/
├── core/      # Shared types (VersionOutput contract) + logging
├── config/    # Config loading, Zod schemas, JSONC parsing
├── forge/     # Forge (GitHub) collaboration API behind one Forge interface + in-memory fake
├── version/   # Version calculation, bump strategies (sync/single/async)
├── notes/     # Changelog + release notes, LLM enhancement, templates
├── publish/   # Multi-registry publish pipeline, git tags, GitHub Releases
└── release/   # Orchestrator: unified CLI, standing-pr, preview, gate, failure report

docs/               # User docs (see "Documentation rules")
scripts/            # Docs generator, action runner, e2e test harness
fixtures/e2e/       # E2E fixture repos
test/integration/   # Cross-package integration tests
templates/          # Release-notes templates + consumer workflow templates
```

## Architecture Invariants

These are load-bearing; violating them breaks releases.

- **Three-stage pipeline**: version → notes → publish. `VersionOutput` (`packages/core/src/types.ts`) is the JSON contract between stages **and** is persisted inside standing-PR manifests — new fields must be optional, and consumers must tolerate their absence (old manifests live in open PRs).
- **Roll-forward model**: version bumps land on `main` before publishing. A failed publish is never recovered by reverting version commits — publishes are idempotent (already-published versions are skipped; tags and GitHub Releases are only created after a clean publish) and are retried or superseded by the next release.
- **Release-commit prefix**: commit subjects starting with `chore: release ` match `release.ci.skipPatterns` and suppress standing-PR update runs. Release commits must keep this prefix; nothing else should use it.
- **`[skip ci]` placement is deliberately asymmetric**: the direct-release commit on `main` (`version.commitMessage` in config) includes it to stop CI loops — leave it there. The standing-PR release branch's single preparation commit must NOT include it: a squash merge inherits that commit's message, and `[skip ci]` on `main` would suppress the publish workflow.
- **Marker comments**: every bot comment (`<!-- releasekit-preview -->`, `<!-- releasekit-manifest -->`, `<!-- releasekit-publish-failure -->`) is keyed by a distinct HTML marker and posted idempotently (update-in-place, never stack). Machine-readable state embedded in comments uses its own marker line — never parse the human-facing prose.
- **Workflow `if` guards can't read config**: label names in workflow-level guards are hardcoded to defaults; in-step checks against `releasekit.config.json` are the authoritative validation.

## Verification Gate

Before any push:

```bash
pnpm turbo run lint typecheck test   # all tasks must pass
```

Fresh worktrees need `pnpm install` first. If you change dependencies, run `pnpm install` and commit the lockfile; prefer `catalog:` entries in `pnpm-workspace.yaml` for shared versions (follow the existing pattern, e.g. `smol-toml`).

## Documentation Rules

- **`releasekit.schema.json` is generated from the Zod schema** (`packages/config/src/schema.ts`) via `pnpm schema:gen` — never hand-edit it. Field descriptions live in the Zod schema as `.describe('...')` calls; that text is the single source of truth and flows Zod → `releasekit.schema.json` → `docs/configuration.md`. `pnpm schema:check` enforces that the committed JSON Schema matches the Zod schema, and runs in CI (the `lint` job), so the two can never drift. To add or change a config field, edit the Zod schema, then run `pnpm schema:gen && pnpm docs:config`.
- **`docs/configuration.md` is generated** — never hand-edit. Regenerate with `pnpm docs:config` (reads the generated `releasekit.schema.json`). Prose sections live in `scripts/generate-config-docs.ts`.
- CLI flags are documented in `docs/cli.md` — update it when adding/changing flags; derive descriptions from the commander definitions, never invent.
- `packages/release/docs/ci-setup.md` embeds copy-pasteable workflow templates; keep them internally consistent (node version, auth notes) when editing any one of them.

## Coding Standards

- Strict TypeScript; avoid `any`; prefer `undefined` over `null`.
- Biome enforces formatting (2-space indent, single quotes, 120-char lines). Run `pnpm lint` — it covers biome (lint + format) and eslint.
- Conventional commits, angular preset: `feat(release): …`, `fix(config): …`, `docs: …`, `test: …`, `chore: …`. PR titles are validated by CI (semantic-pull-request).

### Comments

- Default to writing no comments. Add one only when the **why** is non-obvious — a hidden constraint, a subtle invariant, a workaround for a specific bug, behavior that would surprise a reader.
- Don't restate what the code already says; don't couple comments to details that drift without signal (version numbers, transient stack traces). Keep the rationale, drop the citation.
- **Do** link load-bearing tracking refs — an issue or PR whose resolution removes or rewrites the commented code.

## Testing

- Vitest specs in `packages/*/test/unit/` (+ `test/integration/` in some packages) and root `test/integration/`.
- **Title convention**: every `it`/`test` title starts with `should …` (e.g. `it('should skip already-published versions', …)`). `describe` blocks are free-form.
- Follow the existing mock harnesses in each package's specs (e.g. `standing-pr.spec.ts`'s octokit mock factory) rather than inventing new patterns.
- E2E lives in `scripts/test-harness` + `fixtures/e2e` (shell-driven, not vitest): `pnpm test:harness`.

## Key Documentation

| File | Purpose |
|------|---------|
| [docs/architecture.md](./docs/architecture.md) | Pipeline design and mental model |
| [docs/release-taxonomy.md](./docs/release-taxonomy.md) | Groups vs. prerequisites vs. selection for multi-package repos |
| [docs/configuration.md](./docs/configuration.md) | Full config reference (**generated**) |
| [docs/cli.md](./docs/cli.md) | Every command and flag |
| [docs/troubleshooting.md](./docs/troubleshooting.md) | Symptom-indexed errors, failed-publish recovery |
| [packages/release/docs/ci-setup.md](./packages/release/docs/ci-setup.md) | Consumer workflow templates, standing-PR mode |
| [docs/action.md](./docs/action.md) | GitHub Action inputs/outputs |
