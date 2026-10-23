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

Design decisions are recorded in `docs/adr/` — check there before reworking a load-bearing choice.

## Commands

- **Before you push:** run `pnpm lint`, `pnpm typecheck` and `pnpm test`. The commit hook only checks staged files, and nothing runs on push. `pnpm test` skips `@releasekit/version`'s own `test/integration/`; run `pnpm --filter @releasekit/version test:integration` when you change the version CLI.
- **One package:** `pnpm --filter <package> test` or `typecheck` skips Turborepo, so it runs against the dependencies' built `dist/`, which may be stale. Build them first with `pnpm turbo run build --filter=<package>^...`.
- **Lint:** a package's own `lint` script is Biome only; `pnpm lint` also runs ESLint.
- **CI-only suites:** `pnpm test` doesn't run the action harness (`test:action:*`, `test:harness:*`), `scripts/test-e2e.ts` or `scripts/test-packages.ts`. Run them when you change a CLI, `action.yml` or what a package ships.

## Gotchas

- Turborepo runs tasks in strict env mode, so a variable that `turbo.json` doesn't declare never reaches the task. Opt-in switches such as `RELEASEKIT_NOTES_LIVE=1` work through `pnpm --filter @releasekit/notes test`, not through `pnpm test`.
- When Vitest detects a coding agent it switches to a terse reporter that hides console output and passing tests; add `--reporter=default` to see them. Runs through Turborepo keep the default reporter, because strict env mode drops the variables Vitest detects.
- Don't put a worktree under `.claude/`, where Claude Code creates them by default. Biome ignores `.claude` paths, so `pnpm lint` there finds no files and fails.

## Code conventions the linters don't check

- Test new behaviour through the path a user hits, such as a CLI command or a package's exported API, not only the helper underneath.
- Default to no comment. Write one only when the *why* isn't clear from the code: a hidden constraint, a workaround, behaviour that would surprise a reader. Don't repeat the code, a JSDoc or a nearby comment, and don't narrate.
