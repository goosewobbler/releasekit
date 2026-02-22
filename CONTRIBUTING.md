# Contributing to ReleaseKit

Thank you for your interest in contributing! This guide covers everything you need to get started.

## Prerequisites

- **Node.js** ≥18 (LTS recommended)
- **pnpm** ≥10 (`npm install -g pnpm`)
- **Git**
- **Rust + Cargo** — only needed if working on Cargo.toml support in `@releasekit/version` or
  `@releasekit/publish`

## Setup

```bash
git clone https://github.com/goosewobbler/releasekit.git
cd releasekit
pnpm install
pnpm build
pnpm test
```

All packages live under `packages/`. The monorepo is managed with pnpm workspaces and Turborepo.

## Development Workflow

### Branch naming

| Prefix | Use for |
|--------|---------|
| `feature/` | New features |
| `fix/` | Bug fixes |
| `docs/` | Documentation only changes |
| `refactor/` | Code changes that don't affect behaviour |
| `chore/` | Build, CI, dependency updates |
| `test/` | Test additions or corrections |

Examples: `feature/cargo-workspace-support`, `fix/version-tag-not-found`, `docs/publish-readme`

### Working on a specific package

```bash
# Build only one package (and its dependencies)
pnpm --filter @releasekit/version build

# Run tests for one package
pnpm --filter @releasekit/version test

# Watch mode during development
pnpm --filter @releasekit/version dev
```

## Commit Conventions

This project uses [Conventional Commits](https://www.conventionalcommits.org/). All commit
messages must follow the format:

```
type(scope): short description

Optional body

Optional footer(s)
```

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`,
`revert`

**Scopes:** `version`, `notes`, `publish`, `config`, `core`, `ci`, `deps`, `root`

**Examples:**
```
feat(version): add workspace-level tag template support
fix(publish): retry cargo publish on transient network error
docs(version): add monorepo versioning mode examples
chore(deps): update vitest to v4
```

Breaking changes: append `!` after the scope, e.g. `feat(core)!: rename VersionOutput fields`.

PR titles are validated by the `pr-title.yml` CI workflow. Since PRs are squash-merged, the PR title becomes the final commit message on `main`.

## Coding Standards

### TypeScript

- Strict mode is enabled (`strict: true` in `tsconfig.json`)
- Prefer `type` imports over `import` for type-only uses
- No `any` — use `unknown` and narrow, or define a proper type

### Style

- Formatting and linting are handled by [Biome](https://biomejs.dev/) — no Prettier or ESLint
- 2-space indentation, single quotes, trailing commas
- Run `pnpm lint` before pushing; CI will reject formatting errors

### Project structure

Each package follows the same layout:

```
packages/<name>/
├── src/           # TypeScript source
├── test/
│   └── unit/      # Vitest unit tests
├── dist/          # Built output (gitignored)
├── package.json
├── tsconfig.json
└── README.md
```

## Testing

- Tests are written with [Vitest](https://vitest.dev/)
- Run the full suite: `pnpm test`
- Run a single package: `pnpm --filter @releasekit/version test`
- Coverage: `pnpm --filter @releasekit/version test:coverage`

All new features and bug fixes should include tests. Pull requests that reduce coverage will be
asked to add tests before merging.

## Pull Request Process

1. Fork the repo and create a branch from `main`
2. Make your changes with appropriate tests
3. Run `pnpm lint && pnpm typecheck && pnpm test` — all must pass
4. Open a PR against `main` using the PR template
5. A maintainer will review and may request changes

PRs are squash-merged. The PR title becomes the squash commit message, so it must follow the
Conventional Commits format.

## Release Process

Releases are fully automated via GitHub Actions:

1. `@releasekit/version` calculates the next version from commit history and updates package files
2. `@releasekit/notes` generates changelogs
3. `@releasekit/publish` publishes to npm (with OIDC provenance) and creates GitHub releases

For first-time setup of the release pipeline in a fork, see [BOOTSTRAP.md](./BOOTSTRAP.md).

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](./CODE_OF_CONDUCT.md). By
participating, you agree to uphold its standards. Please report unacceptable behaviour to
[goosewobbler@protonmail.com](mailto:goosewobbler@protonmail.com).
