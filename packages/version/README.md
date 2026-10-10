# @releasekit/version

> [!WARNING]
> 🚧 **Pre-1.0.0** — ReleaseKit is evolving fast and **💥 breaking changes are common**; it's **not production-ready** until `v1.0.0`. Pin exact versions. See the [main README](../../README.md) for details.

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

**npm:**

```bash
npm install -g @releasekit/version
```

**pnpm:**

```bash
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
| `-c, --config <path>` | Path to config file | `releasekit.config.json` |
| `-b, --bump <type>` | Force bump type: `patch`, `minor`, `major`, `prerelease` | auto |
| `-p, --prerelease [id]` | Create prerelease version (e.g. `beta`) | — |
| `--stable` | Graduate prerelease packages to stable without bumping | `false` |
| `--allow-first-bump` | Acknowledge applying a bump on a first release with an already-stable manifest | `false` |
| `-s, --sync` | Use synchronized versioning across all packages | config |
| `-t, --target <packages>` | Target specific packages (comma-separated) | all |
| `--include-prerequisites` | Also release the changed internal dependencies of `--target` packages | `false` |
| `--project-dir <path>` | Project directory | cwd |
| `-d, --dry-run` | Preview without file changes or git operations | `false` |
| `-j, --json` | Output results as a JSON envelope (see below) | `false` |
| `--output <path>` | Write the JSON envelope to a file instead of stdout (resolved against the directory you run from) | — |

## JSON Output

With `--json` (or `--output <file>`), the result is wrapped in the uniform [CLI envelope](../../docs/cli.md#json-output-contract): `status`, `changed`, `warnings`, and `errors` sit alongside the payload, and the version data itself is at `data`:

```json
{
  "schemaVersion": 1,
  "status": "success",
  "changed": false,
  "data": {
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
    "commitMessage": "chore: release v1.2.3",
    "tags": ["v1.2.3"]
  },
  "warnings": [],
  "errors": []
}
```

`@releasekit/notes` and `@releasekit/publish` unwrap the envelope on input, so their `--input` and stdin accept this output directly (a bare `data` object is still accepted too). A script reading the output itself should read `.data` — for example `jq '.data.updates[]'`. On failure, `status` is `"error"`, `data` is `null`, and `errors[]` carries a machine-readable `code`.

## Configuration

Configure via `releasekit.config.json`:

```json
{
  "version": {
    "preset": "conventionalcommits",
    "versionPrefix": "v",
    "tagTemplate": "${prefix}${version}",
    "commitMessage": "chore: release ${packageName} v${version}",
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
| `commitMessage` | Commit message template | `"chore: release ${packageName} v${version}"` |
| `sync` | Version all packages together | `false` |
| `packages` | Package name patterns to include | all |
| `skip` | Package name patterns to exclude | `[]` |
| `mainPackage` | Package to drive version calculation | — |
| `packageSpecificTags` | Create per-package tags | `false` |
| `strictReachable` | Only use reachable git tags | `false` |
| `cargo.enabled` | Update Cargo.toml files | `true` |
| `cargo.paths` | Directories containing Cargo.toml | auto-detect |

## Using in CI

A few things to keep in mind when running `releasekit-version` in a pipeline:

- **Always pass `fetch-depth: 0`** on checkout — the tool reads git history to determine the version bump and will produce incorrect results on a shallow clone.
- **Use `--json` or `--output <file>`** for reliable downstream parsing. Text output format can change; the JSON envelope's `schemaVersion` changes only on a breaking change to its shape.
- **`NO_COLOR=1`** disables ANSI colour codes in log output. Most CI environments set `CI=true` automatically, which the tool detects and adjusts for.

If you are running the full release pipeline (version + changelog + publish), use `@releasekit/release` instead of invoking `releasekit-version` directly. See the [CI setup guide](../release/docs/ci-setup.md).

## Programmatic API

`@releasekit/version` can be used as a library in Node.js code. The main entry point is `VersionEngine`.

```ts
import {
  loadConfig,
  VersionEngine,
  enableJsonOutput,
  getJsonData,
} from '@releasekit/version';
import type { VersionOutput, VersionRunOptions } from '@releasekit/version';

// 1. Load config from releasekit.config.json
const config = loadConfig({ cwd: '/path/to/project' });

// 2. Describe runtime overrides (none of these mutate the config object)
const runOptions: VersionRunOptions = {
  bump: 'minor',       // force bump type
  dryRun: true,        // preview only
  targets: ['pkg-a'],  // limit to specific packages
};

// 3. Enable JSON capture so getJsonData() has results to return
enableJsonOutput(runOptions.dryRun);

// 4. Run the engine
const engine = new VersionEngine(config, runOptions);
const packages = await engine.getWorkspacePackages();
await engine.run(packages);

// 5. Retrieve the structured output
const output: VersionOutput = getJsonData();
// output.updates   — packages that received a version bump
// output.changelogs — per-package changelog entries
// output.tags       — git tags that were (or would be) created
```

### `VersionRunOptions`

All fields are optional. These are applied on top of the loaded config without mutating it.

| Field | Type | Description |
|-------|------|-------------|
| `bump` | `'major' \| 'minor' \| 'patch'` | Force a specific bump type |
| `prerelease` | `string \| boolean` | Create a prerelease; `true` uses the configured identifier, a string overrides it |
| `stable` | `boolean` | Graduate prerelease packages to stable; skip already-stable ones (unless `bump` is also set) |
| `dryRun` | `boolean` | Preview only — no files written, no git operations |
| `sync` | `boolean` | Version all packages together at the same version |
| `targets` | `string[]` | Limit processing to these package name patterns |

### `VersionOutput`

The output type is also exported from `@releasekit/core`:

```ts
import type { VersionOutput } from '@releasekit/version';
```

Pass the result directly to `versionOutputToChangelogInput` from `@releasekit/notes` to generate changelogs without serialising to JSON.

## Documentation

- [Versioning Strategies and Concepts](./docs/versioning.md)

## Acknowledgements

Originally forked from and inspired by [`jucian0/turbo-version`](https://github.com/jucian0/turbo-version).

## License

MIT
