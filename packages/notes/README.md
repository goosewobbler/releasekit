# changelog-creator

A CLI tool for generating changelogs with LLM-powered enhancement and flexible templating.

## Features

- **Multiple input sources**: package-versioner JSON, git log, manual JSON
- **Flexible templating**: Liquid, Handlebars, EJS - single file or composable
- **LLM enhancement** (optional): Summarize, categorize, enhance descriptions, generate release notes
- **Monorepo support**: Root aggregation, per-package changelogs, or both
- **Multiple outputs**: Markdown, JSON, GitHub Releases API

## Installation

```bash
npm install -g changelog-creator
# or
pnpm add -g changelog-creator
```

## Quick Start

```bash
# Pipe from package-versioner
npx package-versioner --json | changelog-creator

# From file
changelog-creator --input version-data.json

# With LLM enhancement
changelog-creator --input version-data.json --llm-provider openai --llm-model gpt-4o-mini
```

## CLI Commands

### `changelog-creator generate` (default)

Generate changelog from input data.

```bash
changelog-creator [options]

Options:
  -i, --input <file>          Input file (default: stdin)
  -o, --output <spec>         Output spec (format:file)
  -t, --template <path>       Template file or directory
  -e, --engine <engine>       Template engine (handlebars|liquid|ejs)
  --monorepo <mode>           Monorepo mode (root|packages|both)
  --llm-provider <provider>   LLM provider
  --llm-model <model>         LLM model
  --llm-tasks <tasks>         Comma-separated LLM tasks
  --no-llm                    Disable LLM processing
  --config <path>             Config file path
  --dry-run                   Preview without writing
  --regenerate                Regenerate entire changelog
  -v, --verbose               Increase verbosity
  -q, --quiet                 Suppress non-error output
```

### `changelog-creator init`

Create a default configuration file.

```bash
changelog-creator init [--force]
```

### `changelog-creator auth <provider>`

Configure API key for an LLM provider.

```bash
changelog-creator auth openai --key sk-...
changelog-creator auth anthropic
```

### `changelog-creator providers`

List available LLM providers.

## Configuration

Create `changelog.config.json` in your project root:

```json
{
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
```

### Config Locations (precedence)

1. `CHANGELOG_CONFIG_CONTENT` env var
2. `--config` CLI flag
3. `changelog.config.json` in project
4. `~/.config/changelog-creator/config.json`

## Input Sources

### package-versioner JSON

```bash
npx package-versioner --json | changelog-creator
```

### Git Log

```bash
changelog-creator --input-source git-log --from v1.0.0 --to HEAD
```

### Manual JSON

```json
{
  "packages": [{
    "packageName": "my-app",
    "version": "1.2.0",
    "entries": [
      { "type": "added", "description": "New feature" }
    ]
  }]
}
```

## Templates

### Single File

```bash
changelog-creator --template ./my-changelog.liquid
```

### Composable

```bash
changelog-creator --template ./templates/
```

Directory structure:
```
templates/
├── document.liquid
├── version.liquid
└── entry.liquid
```

### Built-in Templates

- `keep-a-changelog` - Default, Keep a Changelog format
- `angular` - Angular-style changelog
- `github-release` - GitHub release notes

## LLM Providers

| Provider | Config | Notes |
|----------|--------|-------|
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

## Monorepo Support

```bash
# Root changelog only (aggregates all packages)
changelog-creator --monorepo root

# Per-package changelogs
changelog-creator --monorepo packages

# Both
changelog-creator --monorepo both
```

## Output Formats

### Markdown

```bash
changelog-creator -o markdown:CHANGELOG.md
```

### JSON

```bash
changelog-creator -o json:changelog.json
```

### GitHub Release

```bash
changelog-creator -o github-release
# Requires GITHUB_TOKEN env var
```

## License

MIT
