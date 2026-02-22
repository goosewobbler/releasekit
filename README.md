# ReleaseKit

[![version npm](https://img.shields.io/npm/v/@releasekit/version.svg)](https://www.npmjs.com/package/@releasekit/version)
[![publish npm](https://img.shields.io/npm/v/@releasekit/publish.svg?label=@releasekit/publish)](https://www.npmjs.com/package/@releasekit/publish)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Lightweight, composable release tooling for JavaScript and Rust projects. Built on conventional
commits and designed for CI/CD pipelines.

## Packages

| Package | Description |
|---------|-------------|
| [@releasekit/version](./packages/version) | Semantic versioning based on Git history and conventional commits |
| [@releasekit/notes](./packages/notes) | Changelog generation with LLM-powered enhancement and flexible templating |
| [@releasekit/publish](./packages/publish) | Publish packages to npm and crates.io with git tagging and GitHub releases |
| [@releasekit/config](./packages/config) | *(internal)* Shared config loading and schema validation |
| [@releasekit/core](./packages/core) | *(internal)* Shared types and utilities |

## Features

- **Conventional Commits** — automatically derives the next semver bump from commit history
- **Monorepo support** — versions packages independently or in sync, with per-package git tags
- **JavaScript + Rust** — handles `package.json` and `Cargo.toml` side by side
- **CI/CD first** — JSON output mode for scriptable pipelines; OIDC-based npm publishing
- **LLM-enhanced changelogs** — optional AI summarisation via Anthropic, OpenAI, or local models
- **Composable** — use each tool independently or pipe them together

## Usage

The three CLI tools are designed to be piped together:

```bash
# 1. Calculate next versions and emit JSON
releasekit-version --json

# 2. Generate changelogs from the version output
releasekit-version --json | releasekit-notes

# 3. Publish packages to registries, create git tags and GitHub releases
releasekit-version --json | releasekit-publish
```

Each tool can also be used independently. See the package READMEs for full CLI reference.

## Documentation

- [@releasekit/version — README](./packages/version/README.md)
- [@releasekit/version — Versioning strategies](./packages/version/docs/versioning.md)
- [@releasekit/version — CI/CD integration](./packages/version/docs/CI_CD_INTEGRATION.md)
- [@releasekit/notes — README](./packages/notes/README.md)
- [@releasekit/publish — README](./packages/publish/README.md)
- [Bootstrap guide](./BOOTSTRAP.md) — first-time setup for self-hosted releases
- [Contributing](./CONTRIBUTING.md)

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Lint and typecheck
pnpm lint
pnpm typecheck
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full development guide.

## License

MIT
