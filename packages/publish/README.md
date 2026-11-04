# @releasekit/publish

> [!WARNING]
> 🚧 **Pre-1.0.0** — ReleaseKit is evolving fast and **💥 breaking changes are common**; it's **not production-ready** until `v1.0.0`. Pin exact versions. See the [main README](../../README.md) for details.

[![@releasekit/publish](https://img.shields.io/badge/@releasekit-publish-9feaf9?labelColor=1a1a1a&style=plastic)](https://www.npmjs.com/package/@releasekit/publish)
[![Version](https://img.shields.io/npm/v/@releasekit/publish?color=28a745&labelColor=1a1a1a)](https://www.npmjs.com/package/@releasekit/publish)
[![Downloads](https://img.shields.io/npm/dw/@releasekit/publish?color=6f42c1&labelColor=1a1a1a)](https://www.npmjs.com/package/@releasekit/publish)

**Publish packages to npm and crates.io with git tagging and GitHub releases.**

## Features

- **npm publishing** with OIDC provenance support
- **crates.io publishing** for Rust packages
- **Git tagging** with customizable tag templates
- **GitHub releases** with auto-generated notes
- **Retry logic** for flaky registry operations
- **Dry-run mode** for safe testing
- **JSON output** for CI integration
- **Post-publish verification** to confirm packages are available

## Installation

**npm:**

```bash
npm install -g @releasekit/publish
```

**pnpm:**

```bash
pnpm add -g @releasekit/publish
```

> **Note:** This package is ESM only and requires Node.js 20+.

## Quick Start

`@releasekit/publish` reads JSON output from `@releasekit/version` and runs a publish pipeline:

```bash
# Pipe from version to publish
releasekit-version --json | releasekit-publish

# Or use an input file
releasekit-version --json > version-output.json
releasekit-publish --input version-output.json
```

## Pipeline Stages

Publish prepares files, creates the commit and tags locally, then publishes. What happens after a failure depends on the mode. The full order — batch, per-package, and standing-PR — is in [Publish order and partial failure](../../docs/architecture.md#publish-order-and-partial-failure).

Registries run npm, then crates.io, then pub.dev. The first registry failure stops the run. Already-published versions are skipped on a re-run. Do not delete a tag for a version that was published.

### Auto-retry for transient registry errors

Before failing the stage, the npm and cargo publish steps automatically retry **transient** registry errors — HTTP 5xx, timeouts (`ETIMEDOUT`), connection resets (`ECONNRESET`), DNS hiccups (`EAI_AGAIN`), and rate limits (`429`). Each package is retried up to **2 times** (3 attempts total) with exponential backoff. **Permanent** errors — authentication failures, missing scope/package, and validation errors — fail fast with no retries. The attempt count is recorded in the per-package publish result. Re-running a publish that partially landed is safe: the already-published pre-check (and the conflict detection on the publish error itself) resolves it as a skip rather than a duplicate publish, including on a retry attempt.

## CLI Reference

Flags are in the [CLI reference](../../docs/cli.md#releasekit-publish).

## Integration with @releasekit/version

### Pipe Directly

```bash
releasekit-version --json --dry-run | releasekit-publish --dry-run
```

### Use Output File

```bash
releasekit-version --json > version-output.json
releasekit-publish --input version-output.json
```

### In CI (GitHub Actions)

```yaml
- name: Configure permissions (OIDC + git pushes)
  # at job level:
  # permissions:
  #   id-token: write
  #   contents: write

- name: Version
  run: releasekit-version --json > version-output.json

- name: Publish
  run: releasekit-publish --input version-output.json
  # For OIDC trusted publishing: no npm token needed (recommended).
  # For token-based publishing: set NPM_TOKEN (or NODE_AUTH_TOKEN).
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Configuration

Configure via `releasekit.config.json`:

```json
{
  "publish": {
    "npm": {
      "enabled": true,
      "auth": "auto",
      "provenance": true,
      "access": "public",
      "copyFiles": ["LICENSE"]
    },
    "git": {
      "pushMethod": "auto",
      "httpsTokenEnv": "GITHUB_TOKEN"
    },
    "cargo": {
      "enabled": true,
      "noVerify": false
    },
    "githubRelease": {
      "enabled": true,
      "draft": true,
      "body": "auto"
    },
    "verify": {
      "npm": {
        "maxAttempts": 5,
        "initialDelay": 15000
      },
      "cargo": {
        "maxAttempts": 10,
        "initialDelay": 30000
      }
    }
  }
}
```

See [@releasekit/config](../config/README.md) for full configuration options.

## Documentation

**Guides**
- [GitHub Releases](./docs/github-releases.md) — release body options, LLM prose, draft workflow

## License

MIT
