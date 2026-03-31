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

ReleaseKit uses a single `releasekit.config.json` file at the project root:

```jsonc
{
  "git": { "remote": "origin", "branch": "main" },
  "version": { "tagTemplate": "v{version}", "preset": "conventional" },
  "publish": { "npm": { "enabled": true, "access": "public" } },
  "notes": { "changelog": { "mode": "root" } },
  "ci": {
    "releaseStrategy": "direct",   // "manual" | "direct" | "standing-pr" | "scheduled"
    "releaseTrigger": "label",     // "commit" | "label"
    "prPreview": true,
    "labels": {
      "stable": "release:stable",
      "prerelease": "release:prerelease",
      "skip": "release:skip",
      "major": "release:major",
      "minor": "release:minor",
      "patch": "release:patch"
    }
  }
}
```

See [@releasekit/release — CI Configuration](./packages/release/README.md#ci-configuration) for full details on release triggers, strategies, and PR labels.

## Documentation

- [@releasekit/release — README](./packages/release/README.md)
- [@releasekit/release — CI Configuration](./packages/release/README.md#ci-configuration)
- [@releasekit/version — README](./packages/version/README.md)
- [@releasekit/version — Versioning strategies](./packages/version/docs/versioning.md)
- [@releasekit/version — CI/CD integration](./packages/version/docs/CI_CD_INTEGRATION.md)
- [@releasekit/notes — README](./packages/notes/README.md)
- [@releasekit/publish — README](./packages/publish/README.md)
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
