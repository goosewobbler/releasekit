# @releasekit/notes

Changelog generation with LLM-powered enhancement and flexible templating.

## Features

- **Multiple input sources** — `@releasekit/version` JSON, git log, or manual JSON
- **Flexible templating** — Liquid, Handlebars, or EJS with single-file or composable templates
- **LLM enhancement** (optional) — summarize, categorize, enhance descriptions, generate release notes
- **Monorepo support** — root aggregation, per-package changelogs, or both
- **Multiple outputs** — Markdown, JSON, or GitHub Releases API
- **Dry-run mode** — preview without writing files

## Installation

```bash
npm install -g @releasekit/notes
# or
pnpm add -g @releasekit/notes
```

## Quick Start

```bash
# Pipe from @releasekit/version
releasekit-version --json | releasekit-notes

# From a file
releasekit-notes --input version-data.json

# With LLM enhancement
releasekit-notes --input version-data.json --llm-provider openai --llm-model gpt-4o-mini

# Preview without writing
releasekit-notes --dry-run
```

## CLI Reference

| Flag | Description | Default |
|------|-------------|---------|
| `-i, --input <file>` | Input file path | stdin |
| `-o, --output <spec>` | Output spec (`format:file`) | config |
| `-t, --template <path>` | Template file or directory | built-in |
| `-e, --engine <engine>` | Template engine: `handlebars`, `liquid`, `ejs` | `liquid` |
| `--monorepo <mode>` | Monorepo mode: `root`, `packages`, `both` | — |
| `--llm-provider <name>` | LLM provider | — |
| `--llm-model <model>` | LLM model | — |
| `--llm-tasks <tasks>` | Comma-separated LLM tasks | — |
| `--no-llm` | Disable LLM processing | `false` |
| `--config <path>` | Config file path | `releasekit.config.json` |
| `--dry-run` | Preview without writing | `false` |
| `--regenerate` | Regenerate entire changelog | `false` |
| `-v, --verbose` | Verbose logging | `false` |
| `-q, --quiet` | Suppress non-error output | `false` |

## Subcommands

### `releasekit-notes init`

Create a default configuration file.

```bash
releasekit-notes init [--force]
```

### `releasekit-notes auth <provider>`

Configure API key for an LLM provider.

```bash
releasekit-notes auth openai --key sk-...
releasekit-notes auth anthropic
```

### `releasekit-notes providers`

List available LLM providers.

## Configuration

Configure via `releasekit.config.json`:

```json
{
  "notes": {
    "output": [
      { "format": "markdown", "file": "CHANGELOG.md" }
    ],
    "updateStrategy": "prepend",
    "templates": {
      "path": "./templates/",
      "engine": "liquid"
    },
    "llm": {
      "provider": "openai",
      "model": "gpt-4o-mini",
      "tasks": {
        "summarize": true,
        "enhance": true
      }
    }
  }
}
```

## LLM Providers

| Provider | Config Key | Notes |
|----------|------------|-------|
| OpenAI | `openai` | Requires `OPENAI_API_KEY` |
| Anthropic | `anthropic` | Requires `ANTHROPIC_API_KEY` |
| Ollama | `ollama` | Local, no API key needed |
| OpenAI-Compatible | `openai-compatible` | Any OpenAI-compatible endpoint |

### LLM Tasks

| Task | Description |
|------|-------------|
| `enhance` | Improve entry descriptions |
| `summarize` | Create version summary |
| `categorize` | Group entries by category |
| `releaseNotes` | Generate release notes |

## Templates

### Built-in

- `keep-a-changelog` — Keep a Changelog format (default)
- `angular` — Angular-style changelog
- `github-release` — GitHub release notes

### Custom Templates

```bash
# Single file
releasekit-notes --template ./my-changelog.liquid

# Composable directory
releasekit-notes --template ./templates/
```

Composable directory structure:

```
templates/
├── document.liquid
├── version.liquid
└── entry.liquid
```

## Monorepo Support

```bash
# Root changelog only (aggregates all packages)
releasekit-notes --monorepo root

# Per-package changelogs
releasekit-notes --monorepo packages

# Both
releasekit-notes --monorepo both
```

## License

MIT
