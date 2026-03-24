# @releasekit/release

Unified release pipeline: version, changelog, and publish in a single command.

## Features

- **Single command** — runs version, notes, and publish as one pipeline
- **Programmatic orchestration** — calls each tool's API directly, no subprocesses
- **CI-friendly** — exits cleanly (code 0) when there are no releasable changes
- **Skippable steps** — skip notes, publish, git, or GitHub releases independently
- **Dry-run mode** — preview the full pipeline without side effects
- **JSON output** — structured results for scripting and CI integration
- **Monorepo support** — target specific packages or version all in sync

## Installation

```bash
npm install -g @releasekit/release
# or
pnpm add -g @releasekit/release
```

> **Note:** This package is ESM only and requires Node.js 20+.

## Quick Start

```bash
# Preview what would happen
releasekit release --dry-run

# Run a full release
releasekit release

# Force a patch bump
releasekit release --bump patch

# Version and publish, skip changelog generation
releasekit release --skip-notes
```

## Pipeline

The release command runs three steps in order:

1. **Version** — analyse conventional commits and calculate the next semver bump
2. **Notes** — generate changelog from the version output *(skippable)*
3. **Publish** — git commit/tag, npm/cargo publish, GitHub release *(skippable)*

If no releasable changes are found after step 1, the command exits with code 0 and skips the remaining steps.

## CLI Reference

| Flag | Description | Default |
|------|-------------|---------|
| `-c, --config <path>` | Path to config file | `releasekit.config.json` |
| `-d, --dry-run` | Preview all steps without side effects | `false` |
| `-b, --bump <type>` | Force bump type: `patch`, `minor`, `major` | auto |
| `-p, --prerelease [id]` | Create prerelease version | — |
| `-s, --sync` | Synchronized versioning across all packages | `false` |
| `-t, --target <packages>` | Target specific packages (comma-separated) | all |
| `--skip-notes` | Skip changelog generation | `false` |
| `--skip-publish` | Skip registry publishing and git operations | `false` |
| `--skip-git` | Skip git commit/tag/push | `false` |
| `--skip-github-release` | Skip GitHub release creation | `false` |
| `--skip-verification` | Skip post-publish verification | `false` |
| `-j, --json` | Output results as JSON | `false` |
| `-v, --verbose` | Verbose logging | `false` |
| `-q, --quiet` | Suppress non-error output | `false` |
| `--project-dir <path>` | Project directory | cwd |

## Usage Examples

### In CI (GitHub Actions)

```yaml
- name: Release
  run: releasekit release
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    # For OIDC trusted publishing: no npm token needed (recommended).
    # For token-based publishing: set NPM_TOKEN (or NODE_AUTH_TOKEN).
```

### Automated releases on push to main

```yaml
on:
  push:
    branches: [main]

jobs:
  release:
    if: "!contains(github.event.head_commit.message, '[skip ci]')"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
      - run: npm install -g @releasekit/release
      - run: releasekit release
```

### Monorepo with targeted release

```bash
# Release only specific packages
releasekit release --target @myorg/core,@myorg/cli

# Release all packages in sync
releasekit release --sync
```

### Prerelease workflow

```bash
releasekit release --prerelease beta
```

## Programmatic API

```typescript
import { runRelease } from '@releasekit/release';

const result = await runRelease({
  dryRun: true,
  bump: 'minor',
  skipNotes: false,
  skipPublish: false,
  skipGit: false,
  skipGithubRelease: false,
  skipVerification: false,
  sync: false,
  json: false,
  verbose: false,
  quiet: false,
  projectDir: process.cwd(),
});

if (result) {
  console.log(`Released ${result.versionOutput.updates.length} packages`);
} else {
  console.log('No releasable changes');
}
```

## Configuration

All configuration is shared via `releasekit.config.json`. The release command reads the `version`, `notes`, and `publish` sections as needed.

See the individual package READMEs for configuration details:

- [@releasekit/version](../version/README.md) — versioning options
- [@releasekit/notes](../notes/README.md) — changelog options
- [@releasekit/publish](../publish/README.md) — publishing options

## License

MIT
