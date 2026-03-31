# ReleaseKit

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Lightweight, composable release tooling for JavaScript and Rust projects. Built on conventional
commits and designed for CI/CD pipelines.

## Packages

| Package | Version | Description |
|---------|---------|-------------|
| [@releasekit/release](./packages/release) | [![npm](https://img.shields.io/npm/v/@releasekit/release.svg)](https://www.npmjs.com/package/@releasekit/release) | **Unified CLI** — run version, notes, and publish in a single command |
| [@releasekit/version](./packages/version) | [![npm](https://img.shields.io/npm/v/@releasekit/version.svg)](https://www.npmjs.com/package/@releasekit/version) | Semantic versioning based on Git history and conventional commits |
| [@releasekit/notes](./packages/notes) | [![npm](https://img.shields.io/npm/v/@releasekit/notes.svg)](https://www.npmjs.com/package/@releasekit/notes) | Changelog generation with LLM-powered enhancement and flexible templating |
| [@releasekit/publish](./packages/publish) | [![npm](https://img.shields.io/npm/v/@releasekit/publish.svg)](https://www.npmjs.com/package/@releasekit/publish) | Publish packages to npm and crates.io with git tagging and GitHub releases |
| [@releasekit/config](./packages/config) | — | *(internal)* Shared config loading and schema validation |
| [@releasekit/core](./packages/core) | — | *(internal)* Shared types and utilities |

## Features

- **Conventional Commits** — automatically derives the next semver bump from commit history
- **Monorepo support** — versions packages independently or in sync, with per-package git tags
- **JavaScript + Rust** — handles `package.json` and `Cargo.toml` side by side
- **CI/CD first** — JSON output mode for scriptable pipelines; OIDC or token-based npm publishing
- **PR release previews** — posts a comment on PRs showing what would be released if merged
- **Config-driven CI automation** — control release triggers (commit vs label) and strategies per repo
- **Changelog generation** — auto-generated from conventional commits with flexible templating
- **LLM-enhanced release notes** — optional AI summarisation via Anthropic, OpenAI, or local models
- **Composable** — use each tool independently or pipe them together

## Usage

### Unified release (recommended)

```bash
# Preview the full release pipeline
releasekit --dry-run

# Run a full release: version, changelog, and publish
releasekit

# Skip changelog generation
releasekit --skip-notes

# Force a patch bump
releasekit --bump patch
```

Individual steps are also available as subcommands:

```bash
releasekit version --dry-run --json
releasekit notes --dry-run
releasekit publish --dry-run
```

### Composable tools

Each tool can also be used independently or piped together:

```bash
# Preview changes (dry run)
releasekit-version --dry-run --json

# Run version once, use output for both notes and publish
output=$(releasekit-version --json)
echo "$output" | releasekit-notes
echo "$output" | releasekit-publish

# Changelog-only (no publishing)
releasekit-version --json | releasekit-notes

# Publish-only (no changelog)
releasekit-version --json | releasekit-publish
```

See the package READMEs for full CLI reference.

## Configuration

ReleaseKit uses a single `releasekit.config.json` at the project root. Add `$schema` for editor autocompletion:

```json
{
  "$schema": "https://goosewobbler.github.io/releasekit/schema.json",
  "notes": {
    "changelog": { "mode": "root" }
  },
  "publish": {
    "npm": { "enabled": true, "access": "public" }
  }
}
```

All configuration is optional — ReleaseKit uses sensible defaults. The full set of top-level keys:

| Key | Description |
|-----|-------------|
| `git` | Remote name, branch, push method |
| `version` | Tag template, commit presets, monorepo strategy |
| `notes` | Changelog and release notes output, templates, LLM |
| `publish` | npm, Cargo, GitHub Releases |
| `release` | Pipeline steps, CI skip patterns |
| `ci` | Release triggers, PR labels, preview comments |
| `monorepo` | Package paths for monorepo projects |

See the per-package docs for full option references.

## Documentation

**[Getting Started](./docs/getting-started.md)** — install, first dry run, first release, CI setup

**Reference**
- [@releasekit/release](./packages/release/README.md) — unified pipeline, CI automation, programmatic API
- [@releasekit/version](./packages/version/README.md) — versioning strategies, JSON output
- [@releasekit/notes](./packages/notes/README.md) — changelog, release notes, LLM, templates
- [@releasekit/publish](./packages/publish/README.md) — npm, crates.io, GitHub Releases

**Guides**
- [CI setup](./packages/release/docs/ci-setup.md) — GitHub Actions workflows
- [LLM providers](./packages/notes/docs/llm-providers.md) — AI-enhanced release notes
- [GitHub Releases](./packages/publish/docs/github-releases.md) — release body options

[Contributing](./CONTRIBUTING.md)

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
