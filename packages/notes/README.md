# @releasekit/notes

[![@releasekit/notes](https://img.shields.io/badge/@releasekit-notes-9feaf9?labelColor=1a1a1a&style=plastic)](https://www.npmjs.com/package/@releasekit/notes)
[![Version](https://img.shields.io/npm/v/@releasekit/notes?color=28a745&labelColor=1a1a1a)](https://www.npmjs.com/package/@releasekit/notes)
[![Downloads](https://img.shields.io/npm/dw/@releasekit/notes?color=6f42c1&labelColor=1a1a1a)](https://www.npmjs.com/package/@releasekit/notes)

**Changelog and release notes generation from conventional commits**

Generates CHANGELOG.md and release notes from `@releasekit/version` output, with optional LLM-powered enhancement and flexible templating.

## Features

- 📝 **Conventional changelog** — Keep a Changelog, Angular, or custom format
- 🤖 **LLM enhancement** (optional) — enhance descriptions, summarize, categorize, or generate prose release notes
- 🎨 **Flexible templating** — Liquid, Handlebars, or EJS; single-file or composable layout
- 📦 **Monorepo support** — root aggregation, per-package changelogs, or both
- 🔀 **Two outputs** — `CHANGELOG.md` and `RELEASE_NOTES.md` are configured independently
- 🔍 **Dry-run mode** — preview without writing files

## Installation

```bash
npm install -g @releasekit/notes
# or
pnpm add -g @releasekit/notes
```

> **Note:** ESM only. Requires Node.js 20+.

## Quick Start

```bash
# Pipe from @releasekit/version
releasekit-version --json | releasekit-notes

# From a file
releasekit-notes --input version-data.json

# Preview without writing
releasekit-notes --dry-run

# With LLM enhancement
releasekit-notes --input version-data.json \
  --llm-provider openai \
  --llm-model gpt-4o-mini \
  --llm-tasks enhance,summarize
```

## CLI Reference

### `releasekit-notes generate` (default)

| Flag | Description | Default |
|------|-------------|---------|
| `-i, --input <file>` | Input file path | stdin |
| `--changelog-mode <mode>` | Changelog location: `root`, `packages`, `both` | `root` |
| `--changelog-file <name>` | Changelog file name override | `CHANGELOG.md` |
| `--no-changelog` | Disable changelog generation | — |
| `--release-notes-mode <mode>` | Enable release notes file output: `root`, `packages`, `both` | — |
| `--release-notes-file <name>` | Release notes file name override | `RELEASE_NOTES.md` |
| `--no-release-notes` | Disable release notes generation | — |
| `-t, --template <path>` | Template file or directory | built-in |
| `-e, --engine <engine>` | Template engine: `handlebars`, `liquid`, `ejs` | `liquid` |
| `--monorepo <mode>` | Monorepo mode: `root`, `packages`, `both` | — |
| `--llm-provider <name>` | LLM provider | — |
| `--llm-model <model>` | LLM model | — |
| `--llm-base-url <url>` | Base URL for openai-compatible providers | — |
| `--llm-tasks <tasks>` | Comma-separated tasks: `enhance`, `summarize`, `categorize`, `release-notes` | — |
| `--no-llm` | Disable LLM processing | — |
| `--target <package>` | Filter to a specific package name | — |
| `--config <path>` | Config file path | `releasekit.config.json` |
| `--regenerate` | Regenerate entire file instead of prepending | `false` |
| `--dry-run` | Preview without writing | `false` |
| `-v, --verbose` | Verbose logging (repeat for more: `-vv`) | — |
| `-q, --quiet` | Suppress non-error output | — |

### `releasekit-notes auth <provider>`

Store an API key for an LLM provider.

```bash
releasekit-notes auth openai
releasekit-notes auth anthropic --key sk-ant-...
```

Keys are saved to `~/.config/releasekit/auth.json`.

### `releasekit-notes providers`

List available LLM providers.

## Configuration

All options live under the `notes` key in `releasekit.config.json`:

```json
{
  "$schema": "https://goosewobbler.github.io/releasekit/schema.json",
  "notes": {
    "changelog": {
      "mode": "root",
      "file": "CHANGELOG.md",
      "templates": {
        "path": "./templates/changelog/",
        "engine": "liquid"
      }
    },
    "releaseNotes": {
      "mode": "root",
      "llm": {
        "provider": "openai",
        "model": "gpt-4o-mini",
        "tasks": {
          "enhance": true,
          "summarize": true
        }
      }
    },
    "updateStrategy": "prepend"
  }
}
```

`changelog` and `releaseNotes` are configured independently. Set either to `false` to disable it entirely.

## LLM Providers

LLM configuration lives under `notes.releaseNotes.llm`:

| Provider | Key | Auth |
|----------|-----|------|
| OpenAI | `openai` | `OPENAI_API_KEY` or `releasekit-notes auth openai` |
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY` or `releasekit-notes auth anthropic` |
| Ollama | `ollama` | None (local) |
| OpenAI-compatible | `openai-compatible` | Varies — set `baseURL` and `apiKey` |

### LLM Tasks

| Task | What it does |
|------|-------------|
| `enhance` | Rewrites each changelog entry description to be clearer |
| `summarize` | Generates a one-paragraph summary of the release |
| `categorize` | Groups entries into semantic categories (default set: Breaking, New, Changed, Fixed, Developer) |
| `releaseNotes` | Generates full prose release notes (use as GitHub release body) |

## Templates

### Built-in Templates

| Name | Engine | Description |
|------|--------|-------------|
| `keep-a-changelog` | Liquid | [Keep a Changelog](https://keepachangelog.com) format (default) |
| `angular` | Handlebars | Angular-style changelog |
| `github-release` | EJS | GitHub release notes format |

### Custom Templates

```bash
# Single file
releasekit-notes --template ./my-changelog.liquid

# Composable directory (document + version + entry)
releasekit-notes --template ./templates/
```

See **[Templates guide](./docs/templates.md)** for the full template context reference and authoring guide.

## Monorepo Support

```bash
# Root changelog only (aggregates all packages)
releasekit-notes --changelog-mode root

# Per-package changelogs
releasekit-notes --changelog-mode packages

# Both root and per-package
releasekit-notes --changelog-mode both
```

See **[Monorepo guide](./docs/monorepo.md)** for details on file placement and aggregation behaviour.

## Programmatic API

`@releasekit/notes` can be used as a library in Node.js code.

### With a `VersionOutput` object (recommended)

When integrating with `@releasekit/version` programmatically, pass the typed output directly — no JSON round-trip needed:

```ts
import { versionOutputToChangelogInput, runPipeline, loadConfig } from '@releasekit/notes';
import type { VersionOutput } from '@releasekit/version';

// versionOutput comes from getJsonData() after running VersionEngine
const input = versionOutputToChangelogInput(versionOutput);

const config = loadConfig('/path/to/project');
const result = await runPipeline(input, config, /* dryRun */ false);

// result.packageNotes — per-package rendered markdown, keyed by package name
// result.releaseNotes — per-package release notes (when configured)
// result.files        — file paths written to disk
```

### From JSON

When reading version output from a file or stdin:

```ts
import {
  parseVersionOutput,      // from a JSON string
  parseVersionOutputFile,  // from a file path
  parseVersionOutputStdin, // from stdin
  runPipeline,
  loadConfig,
} from '@releasekit/notes';

const input = parseVersionOutputFile('./version-output.json');
const config = loadConfig();
const result = await runPipeline(input, config, false);
```

### Key exports

| Export | Description |
|--------|-------------|
| `versionOutputToChangelogInput(data)` | Transform a `VersionOutput` to `ChangelogInput` directly |
| `parseVersionOutput(json)` | Parse a JSON string into `ChangelogInput` |
| `parseVersionOutputFile(path)` | Read a file and parse it into `ChangelogInput` |
| `parseVersionOutputStdin()` | Read stdin and parse it into `ChangelogInput` |
| `runPipeline(input, config, dryRun)` | Run the full notes pipeline (templates, LLM, file writes) |
| `loadConfig(projectDir?, configFile?)` | Load `notes` config from `releasekit.config.json` |

## Documentation

**Getting Started**
- [Configuration reference](./docs/configuration.md) — all `notes.*` options
- [LLM providers](./docs/llm-providers.md) — provider setup, auth, tasks, prompt customisation

**Guides**
- [LLM-enhanced release notes](./docs/llm-release-notes.md) — full guide to LLM tasks, categories, output rendering
- [Templates](./docs/templates.md) — custom template authoring and context reference
- [Monorepo](./docs/monorepo.md) — per-package and root output modes

## License

MIT
