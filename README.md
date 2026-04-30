# ReleaseKit

[![npm](https://img.shields.io/npm/v/@releasekit/release.svg)](https://www.npmjs.com/package/@releasekit/release)
[![CI](https://github.com/goosewobbler/releasekit/actions/workflows/ci.yml/badge.svg)](https://github.com/goosewobbler/releasekit/actions/workflows/ci.yml)
[![Node](https://img.shields.io/node/v/@releasekit/release.svg)](https://www.npmjs.com/package/@releasekit/release)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Versioning, changelogs, and publishing for JavaScript and Rust monorepos — driven by Conventional Commits, designed for CI.

## Why ReleaseKit

- **One config, two ecosystems** — JavaScript and Rust packages release from the same `releasekit.config.json`, including mixed monorepos.
- **Composable, not opinionated** — three independent CLIs (`version`, `notes`, `publish`) you can pipe together, or a unified `release` command if you want the full pipeline.
- **CI-native** — JSON output, OIDC publishing, PR preview comments, and label- or commit-driven triggers without bolting on extra tools.

## Quickstart

```bash
npm install -g @releasekit/release
releasekit init
releasekit release --dry-run
```

```text
Running version analysis...
Found 2 package update(s)
  @myorg/core → 1.4.0
  @myorg/ui   → 1.4.0
Generating release notes...
Publishing... (dry-run, no packages published)
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

```bash
releasekit release --dry-run
releasekit release
releasekit release --skip-notes
releasekit release --bump patch
```

Each step is also a subcommand — `releasekit version`, `releasekit notes`, `releasekit publish` — and the underlying tools (`releasekit-version`, `releasekit-notes`, `releasekit-publish`) can be piped together. See the [package docs](#documentation) for the full CLI reference.

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

- [Getting Started](./docs/getting-started.md) — install, first dry run, first release, CI setup
- [@releasekit/release](./packages/release/README.md) — unified pipeline, CI automation, programmatic API
- [@releasekit/version](./packages/version/README.md) — versioning strategies, JSON output
- [@releasekit/notes](./packages/notes/README.md) — changelog, release notes, LLM, templates
- [@releasekit/publish](./packages/publish/README.md) — npm, crates.io, GitHub Releases
- [CI setup](./packages/release/docs/ci-setup.md) · [LLM providers](./packages/notes/docs/llm-providers.md) · [GitHub Releases](./packages/publish/docs/github-releases.md)

## Development

`pnpm install && pnpm build && pnpm test` — see [CONTRIBUTING.md](./CONTRIBUTING.md) for the full guide.

## License

MIT
