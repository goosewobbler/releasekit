# @releasekit/version

Semantic versioning based on Git history and conventional commits.

## Features

- **Conventional commits** — automatic version bumps from commit history (`feat:` → minor, `fix:` → patch, `BREAKING CHANGE` → major)
- **Monorepo support** — sync, single, or independent (async) versioning strategies
- **npm and Rust** — updates both `package.json` and `Cargo.toml` manifests
- **Branch patterns** — determine bumps from branch names (e.g. `feature/*` → minor)
- **Package targeting** — version specific packages with `--target`
- **Prerelease support** — create alpha, beta, or custom prerelease versions
- **Dry-run mode** — preview changes without modifying files or creating tags
- **JSON output** — structured results for piping to `@releasekit/notes` and CI scripts
- **Package-specific tags** — configurable tag templates per package

## Installation

```bash
npm install -g @releasekit/version
# or
pnpm add -g @releasekit/version
```

> **Note:** This package is ESM only and requires Node.js 20+.

## Quick Start

```bash
# Auto-detect bump from conventional commits
releasekit-version

# Force a specific bump type
releasekit-version --bump minor

# Preview without side effects
releasekit-version --dry-run --json

# Target specific packages in a monorepo
releasekit-version --target @scope/core,@scope/cli

# Create a prerelease
releasekit-version --prerelease beta
```

## CLI Reference

| Flag | Description | Default |
|------|-------------|---------|
| `--bump <type>` | Force bump type: `patch`, `minor`, `major` | auto |
| `--prerelease [id]` | Create prerelease version (e.g. `beta`) | — |
| `--target <packages>` | Target specific packages (comma-separated) | all |
| `--project-dir <path>` | Project directory | cwd |
| `--dry-run` | Preview without file changes or git operations | `false` |
| `--json` | Output results as JSON | `false` |
| `--strict-reachable` | Only use tags reachable from current commit | `false` |
| `--verbose` | Verbose logging | `false` |
| `--quiet` | Suppress non-error output | `false` |

## JSON Output

When using `--json`, the tool outputs structured data including version bumps and changelog entries:

```json
{
  "dryRun": true,
  "updates": [
    {
      "packageName": "@scope/core",
      "newVersion": "1.2.3",
      "filePath": "/path/to/package.json"
    }
  ],
  "changelogs": [
    {
      "packageName": "@scope/core",
      "version": "1.2.3",
      "previousVersion": "v1.2.2",
      "revisionRange": "v1.2.2..HEAD",
      "repoUrl": "https://github.com/org/repo",
      "entries": [
        { "type": "added", "description": "New feature" },
        { "type": "fixed", "description": "Bug fix" }
      ]
    }
  ],
  "commitMessage": "chore(release): v1.2.3",
  "tags": ["v1.2.3"]
}
```

This JSON is consumed by `@releasekit/notes` for changelog generation and `@releasekit/publish` for the publish pipeline.

## Configuration

Configure via `releasekit.config.json`:

```json
{
  "version": {
    "preset": "conventionalcommits",
    "versionPrefix": "v",
    "tagTemplate": "${prefix}${version}",
    "commitMessage": "chore(release): v${version}",
    "sync": true,
    "packages": ["@mycompany/*"],
    "skip": ["docs", "e2e"],
    "mainPackage": "primary-package",
    "packageSpecificTags": false,
    "strictReachable": false,
    "cargo": {
      "enabled": true,
      "paths": ["crates/"]
    }
  }
}
```

### Key Options

| Option | Description | Default |
|--------|-------------|---------|
| `preset` | Conventional commits preset | `"conventionalcommits"` |
| `versionPrefix` | Tag version prefix | `"v"` |
| `tagTemplate` | Git tag template | `"${prefix}${version}"` |
| `commitMessage` | Commit message template | `"chore(release): ${version}"` |
| `sync` | Version all packages together | `false` |
| `packages` | Package name patterns to include | all |
| `skip` | Package name patterns to exclude | `[]` |
| `mainPackage` | Package to drive version calculation | — |
| `packageSpecificTags` | Create per-package tags | `false` |
| `strictReachable` | Only use reachable git tags | `false` |
| `cargo.enabled` | Update Cargo.toml files | `true` |
| `cargo.paths` | Directories containing Cargo.toml | auto-detect |

## Documentation

- [Versioning Strategies and Concepts](./docs/versioning.md)
- [CI/CD Integration](./docs/CI_CD_INTEGRATION.md)

## Acknowledgements

Originally forked from and inspired by [`jucian0/turbo-version`](https://github.com/jucian0/turbo-version).

## License

MIT
