# ReleaseKit

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Lightweight, composable release tooling for JavaScript and Rust projects. Built on conventional
commits and designed for CI/CD pipelines.

## Quickstart

```bash
npm install -g @releasekit/release
releasekit init
releasekit release --dry-run
```

See [Getting Started](./docs/getting-started.md) for prerequisites, config options, and a first real release.

## Packages

| Package | Version | Description |
|---------|---------|-------------|
| [@releasekit/release](./packages/release) | [![npm](https://img.shields.io/npm/v/@releasekit/release.svg)](https://www.npmjs.com/package/@releasekit/release) | **Unified CLI** — run version, notes, and publish in a single command |
| [@releasekit/version](./packages/version) | [![npm](https://img.shields.io/npm/v/@releasekit/version.svg)](https://www.npmjs.com/package/@releasekit/version) | Semantic versioning based on Git history and conventional commits |
| [@releasekit/notes](./packages/notes) | [![npm](https://img.shields.io/npm/v/@releasekit/notes.svg)](https://www.npmjs.com/package/@releasekit/notes) | Changelog generation with LLM-powered enhancement and flexible templating |
| [@releasekit/publish](./packages/publish) | [![npm](https://img.shields.io/npm/v/@releasekit/publish.svg)](https://www.npmjs.com/package/@releasekit/publish) | Publish packages to npm and crates.io with git tagging and GitHub releases |

## Features

- **Versioning** — derives semver bumps from Conventional Commits; supports JavaScript (`package.json`), Rust (`Cargo.toml`), and monorepos with per-package tags
- **Release notes** — generates changelogs from commit history, with optional LLM enhancement (Anthropic, OpenAI, or local models)
- **Publishing** — pushes to npm (OIDC or token) and crates.io, tags the release, and creates a GitHub Release
- **CI/CD first** — JSON output for scripting, PR preview comments, and config-driven triggers (commit vs label)
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

### GitHub Action

Use ReleaseKit as a composite action with `release` or `preview` modes:

```yaml
jobs:
  release:
    permissions:
      id-token: write
      contents: write
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: goosewobbler/releasekit@v1
        with:
          mode: release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

See [docs/action.md](./docs/action.md) for the `preview` mode, full input/output reference, and rollout guidance.

## Configuration

ReleaseKit reads `releasekit.config.json` at the project root. All configuration is optional — sensible defaults apply. A typical config:

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

See the [package docs](#documentation) for the full option reference.

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
