<h1 align="center">ReleaseKit</h1>

<p align="center"><em>Versioning, changelogs, and publishing for whatever you ship — driven by Conventional Commits, built for CI.</em></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@releasekit/release"><img alt="npm" src="https://img.shields.io/npm/v/@releasekit/release.svg"></a>
  <a href="https://github.com/goosewobbler/releasekit/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/goosewobbler/releasekit/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://www.npmjs.com/package/@releasekit/release"><img alt="Node" src="https://img.shields.io/node/v/@releasekit/release.svg"></a>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg"></a>
</p>

<p align="center">
  <a href="#why-releasekit">Why</a> ·
  <a href="#quickstart">Quickstart</a> ·
  <a href="#packages">Packages</a> ·
  <a href="#documentation">Docs</a> ·
  <a href="./CONTRIBUTING.md">Contributing</a>
</p>

Releases to npm, crates.io, and pub.dev today, with more ecosystems on the way.

```text
   from Conventional Commits:

   ┌─────────┐     ┌─────────┐     ┌─────────┐
   │ version │ ──▶ │  notes  │ ──▶ │ publish │
   └─────────┘     └─────────┘     └─────────┘
    semver bumps    changelog +     npm · crates.io · pub.dev
    per package     LLM notes       git tags · GitHub Release

   Independent CLIs, piped via a VersionOutput JSON contract — run one stage or all three.
```

> [!WARNING]
> ### 🚧 Pre-1.0.0 — here be dragons 🐉
>
> ReleaseKit is **under active development** and evolving fast while the core feature set settles. **💥 Breaking changes are common between releases** and aren't always gated behind a major bump while we're pre-`1.0.0`. It's **🚫 not recommended for production** yet — if you're trying it out, **📌 pin an exact version** and skim the release notes before upgrading. 🧪 Once the API stabilises, `v1.0.0` will mark the switch to semver-stable guarantees. 🎯

## Why ReleaseKit

- **One config, every ecosystem** — npm (JavaScript/TypeScript), crates.io (Rust), and pub.dev (Dart/Flutter) packages release from the same `releasekit.config.json`, including mixed monorepos. The pipeline is registry-agnostic — new ecosystems plug in without changing your workflow.
- **Composable, not opinionated** — three independent CLIs (`version`, `notes`, `publish`) you can pipe together, or a unified `release` command if you want the full pipeline.
- **CI-native** — JSON output, OIDC publishing, PR preview comments, and label- or commit-driven triggers without bolting on extra tools.

> **Coming from semantic-release or changesets?** See the [Migration guide](./docs/migration.md) for a mapping of concepts and a step-by-step switch.

## Quickstart

**npm:**

```bash
npm install -g @releasekit/release
```

**pnpm:**

```bash
pnpm add -g @releasekit/release
```

**Then:**

```bash
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

All four packages share a single version (sync versioning) — see the version badge above.

| Package | Downloads | Description |
|---------|-----------|-------------|
| [@releasekit/release](./packages/release) | [![downloads](https://img.shields.io/npm/dw/@releasekit/release.svg)](https://www.npmjs.com/package/@releasekit/release) | **Unified CLI** — run version, notes, and publish in a single command |
| [@releasekit/version](./packages/version) | [![downloads](https://img.shields.io/npm/dw/@releasekit/version.svg)](https://www.npmjs.com/package/@releasekit/version) | Semantic versioning based on Git history and conventional commits |
| [@releasekit/notes](./packages/notes) | [![downloads](https://img.shields.io/npm/dw/@releasekit/notes.svg)](https://www.npmjs.com/package/@releasekit/notes) | Changelog generation with LLM-powered enhancement and flexible templating |
| [@releasekit/publish](./packages/publish) | [![downloads](https://img.shields.io/npm/dw/@releasekit/publish.svg)](https://www.npmjs.com/package/@releasekit/publish) | Publish packages to npm, crates.io, and pub.dev with git tagging and GitHub releases |

## Features

- 🔖 **Versioning** — derives semver bumps from Conventional Commits; supports JavaScript/TypeScript (`package.json`), Rust (`Cargo.toml`), Dart/Flutter (`pubspec.yaml`), and monorepos with per-package tags
- 📝 **Release notes** — generates changelogs from commit history, with optional LLM enhancement (Anthropic, OpenAI, or local models)
- 📦 **Publishing** — pushes to npm (OIDC or token), crates.io, and pub.dev, tags the release, and creates a GitHub Release
- ⚙️ **CI/CD first** — JSON output for scripting, PR preview comments, and config-driven triggers (commit vs label)
- 🧩 **Composable** — use each tool independently or pipe them together

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
      - uses: goosewobbler/releasekit@v0
        with:
          mode: release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

See [docs/action.md](./docs/action.md) for the `preview` mode, full input/output reference, and rollout guidance.

## Configuration

ReleaseKit reads `releasekit.config.json` or `releasekit.config.jsonc` (comments and trailing commas supported) at the project root. All configuration is optional — sensible defaults apply. A typical config:

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

**Guides**
- [Getting Started](./docs/getting-started.md) — install, first dry run, first release, CI setup
- [Architecture](./docs/architecture.md) — pipeline design, mental model, release strategies
- [CI setup](./packages/release/docs/ci-setup.md) — GitHub Actions workflows, OIDC, PR preview, prerelease
- [CI examples](./examples) — runnable, CI-validated workflow + config scenarios (minimal, label-driven, standing-PR, OIDC, monorepo-rust, prerelease)
- [Rust / Cargo](./docs/rust.md) — Rust crate versioning and crates.io publishing
- [Dart / pub.dev](./docs/dart.md) — Dart/Flutter versioning and pub.dev publishing
- [Migration](./docs/migration.md) — from semantic-release or changesets

**Reference**
- [CLI](./docs/cli.md) — every command and flag for the `releasekit` CLI
- [Configuration](./docs/configuration.md) — full config reference (all `releasekit.config.json` options)
- [GitHub Action](./docs/action.md) — `goosewobbler/releasekit` action inputs, outputs, and rollout
- [@releasekit/release](./packages/release/README.md) — unified pipeline, CI automation, programmatic API
- [@releasekit/version](./packages/version/README.md) — versioning strategies, JSON output
- [@releasekit/notes](./packages/notes/README.md) — changelog, release notes, LLM, templates
- [@releasekit/publish](./packages/publish/README.md) — npm, crates.io, pub.dev, GitHub Releases

**Help**
- [Troubleshooting](./docs/troubleshooting.md) — symptom-indexed error guide
- [LLM providers](./packages/notes/docs/llm-providers.md) — OpenAI, Anthropic, Ollama setup
- [GitHub Releases](./packages/publish/docs/github-releases.md) — release body options

## Development

`pnpm install && pnpm build && pnpm test` — see [CONTRIBUTING.md](./CONTRIBUTING.md) for the full guide.

## Support

- [GitHub Issues](https://github.com/goosewobbler/releasekit/issues) — bug reports and feature requests
- [Contributing](./CONTRIBUTING.md) — development setup and PR guidelines
- [Security policy](./SECURITY.md) — reporting vulnerabilities
- [Code of Conduct](./CODE_OF_CONDUCT.md)

## License

MIT
