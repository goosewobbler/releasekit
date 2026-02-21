# package-versioner


<a href="https://www.npmjs.com/package/package-versioner" alt="NPM Version">
  <img src="https://img.shields.io/npm/v/package-versioner" /></a>
<a href="https://www.npmjs.com/package/package-versioner" alt="NPM Downloads">
  <img src="https://img.shields.io/npm/dw/package-versioner" /></a>
<br/><br/>
A lightweight yet powerful CLI tool for automated semantic versioning based on Git history and conventional commits. Supports both single package projects and monorepos with flexible versioning strategies.

## Features

- Automatically determines version bumps based on commit history (using conventional commits)
- Supports both single package projects and monorepos with minimal configuration
- Support for both npm (package.json) and Rust (Cargo.toml) projects
- Flexible versioning strategies (e.g., based on commit types, branch patterns)
- Integrates with conventional commits presets
- Customizable through a `version.config.json` file or CLI options
- Automatically updates `package.json` or `Cargo.toml` version
- Creates appropriate Git tags for releases
- Automatically generates and maintains changelogs in Keep a Changelog or Angular format
- Integrates commit messages, breaking changes, and issue references into well-structured changelogs
- CI/CD friendly with JSON output support

## Supporting JavaScript and Rust Projects

`package-versioner` provides version management for both JavaScript/TypeScript (via package.json) and Rust (via Cargo.toml) projects:

- **JavaScript/TypeScript**: Automatically detects and updates version in package.json files
- **Rust**: Detects and updates version in Cargo.toml files using the same versioning strategies
- **Mixed Projects**: Supports repositories containing both package.json and Cargo.toml files

When run, the tool will automatically discover and update the appropriate manifest file based on the project structure.

## Usage

`package-versioner` is designed to be run directly using your preferred package manager's execution command, without needing global installation.

```bash
# Determine bump based on conventional commits since last tag
npx package-versioner

# Using pnpm
pnpm dlx package-versioner

# Using yarn
yarn dlx package-versioner

# Specify a bump type explicitly
npx package-versioner --bump minor

# Create a prerelease (e.g., alpha)
npx package-versioner --bump patch --prerelease alpha

# Target specific packages (only in async/independent mode, comma-separated)
npx package-versioner -t @scope/package-a,@scope/package-b

# Run from a different directory
npx package-versioner --project-dir /path/to/project

# Perform a dry run: calculates version, logs actions, but makes no file changes or Git commits/tags
npx package-versioner --dry-run

# Only use reachable tags (Git-semantic mode, no fallback to unreachable tags)
npx package-versioner --strict-reachable

# Output results as JSON (useful for CI/CD scripts)
npx package-versioner --json

# Combine with dry-run for CI planning
npx package-versioner --dry-run --json
```

**Note on Targeting:** Using the `-t` flag creates package-specific tags (e.g., `@scope/package-a@1.2.0`) but *not* a global tag (like `v1.2.0`). If needed, create the global tag manually in your CI/CD script after this command.

### Git Tag Reachability

By default, `package-versioner` intelligently handles Git tag reachability to provide the best user experience:

- **Default behaviour**: Uses reachable tags when available, but falls back to the latest repository tag if needed (common in feature branches)
- **Strict mode (`--strict-reachable`)**: Only uses tags reachable from the current commit, following strict Git semantics

This is particularly useful when working on feature branches that have diverged from the main branch where newer tags exist. The tool will automatically detect the Git context and provide helpful guidance:

```bash
# On a feature branch with unreachable tags
npx package-versioner --dry-run
# Output: "No tags reachable from current branch 'feature-x'. Using latest repository tag v1.2.3 as version base."
# Tip: Consider 'git merge main' or 'git rebase main' to include tag history in your branch.

# Force strict Git semantics
npx package-versioner --dry-run --strict-reachable
# Output: Uses only reachable tags, may result in "No reachable tags found"
```

## JSON Output

When using the `--json` flag, normal console output is suppressed and the tool outputs a structured JSON object that includes information about the versioning operation.

```json
{
  "dryRun": true,
  "updates": [
    {
      "packageName": "@scope/package-a",
      "newVersion": "1.2.3",
      "filePath": "/path/to/package.json"
    }
  ],
  "changelogs": [
    {
      "packageName": "@scope/package-a",
      "version": "1.2.3",
      "previousVersion": "v1.2.2",
      "revisionRange": "v1.2.2..HEAD",
      "repoUrl": "https://github.com/org/repo",
      "entries": [
        { "type": "added", "description": "New feature", "scope": "core" },
        { "type": "fixed", "description": "Bug fix" }
      ]
    }
  ],
  "commitMessage": "chore(release): v1.2.3",
  "tags": [
    "v@scope/package-a@1.2.3"
  ]
}
```

For detailed examples of how to use this in CI/CD pipelines, see [CI/CD Integration](./docs/CI_CD_INTEGRATION.md).

## Configuration

Customize behaviour by creating a `version.config.json` file in your project root:

```json
{
  "preset": "angular",
  "versionPrefix": "v",
  "tagTemplate": "${packageName}@${prefix}${version}",
  "packageSpecificTags": true,
  "commitMessage": "chore: release ${packageName}@${version} [skip ci]",
  "writeChangelog": true,
  "changelogFormat": "keep-a-changelog",
  "strictReachable": false,
  "sync": true,
  "skip": [
    "docs",
    "e2e"
  ],
  "packages": ["@mycompany/*"],
  "mainPackage": "primary-package",
  "cargo": {
    "enabled": true,
    "paths": ["src/", "crates/"]
  }
}
```

### Configuration Options

#### General Options (All Projects)
- `preset`: Conventional commits preset to use for version calculation (default: "angular")
- `versionPrefix`: Prefix for version numbers in tags (default: "v")
- `tagTemplate`: Template for Git tags (default: "${prefix}${version}")
- `commitMessage`: Template for commit messages (default: "chore(release): ${version}")
- `writeChangelog`: Whether to write changelog files to disk (default: true). Changelog data is always available via `--json` regardless of this setting
- `changelogFormat`: Format for changelogs - "keep-a-changelog" or "angular" (default: "keep-a-changelog")
- `strictReachable`: Only use reachable tags, no fallback to unreachable tags (default: false)
- `prereleaseIdentifier`: Identifier for prerelease versions (e.g., "alpha", "beta", "next") used in versions like "1.2.0-alpha.3"
- `mismatchStrategy`: How to handle version mismatches between git tags and package.json (default: "error"). Options:
  - `"error"`: Throw an error and stop execution, forcing the mismatch to be resolved
  - `"warn"`: Log a warning but continue with the higher version
  - `"prefer-package"`: Use the package.json version when a mismatch is detected
  - `"prefer-git"`: Use the git tag version when a mismatch is detected
  - `"ignore"`: Silently continue with the higher version
- `cargo`: Options for Rust projects:
  - `enabled`: Whether to handle Cargo.toml files (default: true)
  - `paths`: Directories to search for Cargo.toml files (optional)

#### Monorepo-Specific Options
- `sync`: Whether all packages should be versioned together (default: true)
- `skip`: Array of package names or patterns to exclude from versioning. Supports exact names, scope wildcards, path patterns, and global wildcards (e.g., ["@scope/package-a", "@scope/*", "packages/**/*"])
- `packages`: Array of package names or patterns to target for versioning. Supports exact names, scope wildcards, path patterns and global wildcards (e.g., ["@scope/package-a", "@scope/*", "*"])
- `mainPackage`: Package name whose commit history should drive version determination
- `packageSpecificTags`: Whether to enable package-specific tagging behaviour (default: false)
- `updateInternalDependencies`: How to update internal dependencies ("patch", "minor", "major", or "inherit")

For more details on CI/CD integration and advanced usage, see [CI/CD Integration](./docs/CI_CD_INTEGRATION.md).

### Package Targeting

The `packages` configuration option controls which packages are processed for versioning. It supports several pattern types:

#### Exact Package Names
```json
{
  "packages": ["@mycompany/core", "@mycompany/utils", "standalone-package"]
}
```

#### Scope Wildcards
Target all packages within a specific scope:
```json
{
  "packages": ["@mycompany/*"]
}
```

#### Path Patterns / Globs
Target all packages in a directory or matching a path pattern:
```json
{
  "packages": ["packages/**/*", "examples/**"]
}
```
This will match all packages in nested directories under `packages/` or `examples/`.

#### Global Wildcard
Target all packages in the workspace:
```json
{
  "packages": ["*"]
}
```

#### Mixed Patterns
Combine different pattern types:
```json
{
  "packages": ["@mycompany/*", "@utils/logger", "legacy-package", "packages/**/*"]
}
```

**Behaviour:**
- When `packages` is specified, **only** packages matching those patterns will be processed
- When `packages` is empty or not specified, **all** workspace packages will be processed  
- The `skip` option can exclude specific packages from the selected set

**Note**: Your workspace configuration (pnpm-workspace.yaml, package.json workspaces, etc.) determines which packages are available, but the `packages` option directly controls which ones get versioned.

### Package-Specific Tagging

The `packageSpecificTags` option controls whether the tool creates and searches for package-specific Git tags:

- **When `false` (default)**: Creates global tags like `v1.2.3` and searches for the latest global tag
- **When `true`**: Creates package-specific tags like `@scope/package-a@v1.2.3` and searches for package-specific tags

This option works in conjunction with `tagTemplate` to control tag formatting. The `tagTemplate` is used for all tag creation, with the `packageSpecificTags` boolean controlling whether the `${packageName}` variable is populated:

- When `packageSpecificTags` is `false`: The `${packageName}` variable is empty, so templates should use `${prefix}${version}`
- When `packageSpecificTags` is `true`: The `${packageName}` variable contains the package name

**Examples:**

For single-package repositories or sync monorepos:
```json
{
  "packageSpecificTags": true,
  "tagTemplate": "${packageName}@${prefix}${version}"
}
```
Creates tags like `my-package@v1.2.3`

For global versioning:
```json
{
  "packageSpecificTags": false,
  "tagTemplate": "${prefix}${version}"
}
```
Creates tags like `v1.2.3`

**Important Notes:**
- In **sync mode** with a single package, `packageSpecificTags: true` will use the package name even though all packages are versioned together
- In **sync mode** with multiple packages, package names are not used regardless of the setting
- In **async mode**, each package gets its own tag when `packageSpecificTags` is enabled

With package-specific tagging enabled, the tool will:
1. Look for existing tags matching the configured pattern for each package
2. Create new tags using the same pattern when releasing
3. Fall back to global tag lookup if no package-specific tags are found

## How Versioning Works

`package-versioner` determines the next version based on your configuration (`version.config.json`). The two main approaches are:

1.  **Conventional Commits:** Analyzes commit messages (like `feat:`, `fix:`, `BREAKING CHANGE:`) since the last tag.
2.  **Branch Pattern:** Determines the bump based on the current or recently merged branch name matching predefined patterns.

For a detailed explanation of these concepts and monorepo modes (Sync vs. Async), see [Versioning Strategies and Concepts](./docs/versioning.md).

## Documentation

- [Versioning Strategies and Concepts](./docs/versioning.md) - Detailed explanation of versioning approaches
- [CI/CD Integration](./docs/ci_cd_integration.md) - Guide for integrating with CI/CD pipelines
- [Changelog Generation](./docs/changelogs.md) - How changelogs are automatically generated and maintained

For more details on available CLI options, run:

```bash
npx package-versioner --help
```

## Acknowledgements

This project was originally forked from and inspired by [`jucian0/turbo-version`](https://github.com/jucian0/turbo-version). We appreciate the foundational work done by the original authors.

## License

MIT
