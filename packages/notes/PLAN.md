# PLAN: changelog-creator

## Overview

A CLI tool that generates changelogs from structured data. Supports LLM-powered enhancement (optional) and flexible templating (single-file or composable).

## Core Principles

1. **Templates work without LLM** - Raw commit data renders fine
2. **LLM enhances, doesn't replace** - Adds processed data to template context (both raw and enhanced available)
3. **Single-file or composable** - User chooses template complexity
4. **Multiple input sources** - Not locked into package-versioner
5. **CLI-first, library-second** - Optimized for command line usage
6. **Logging consistent with package-versioner** - Same verbosity levels and format

## Repository Structure

```
changelog-creator/
├── src/
│   ├── cli.ts
│   ├── index.ts
│   ├── core/
│   │   ├── pipeline.ts
│   │   ├── types.ts
│   │   └── config.ts
│   ├── input/
│   │   ├── index.ts
│   │   ├── package-versioner.ts
│   │   ├── conventional-changelog.ts
│   │   ├── git-log.ts
│   │   └── manual.ts
│   ├── output/
│   │   ├── index.ts
│   │   ├── markdown.ts
│   │   ├── github-release.ts
│   │   └── json.ts
│   ├── templates/
│   │   ├── index.ts
│   │   ├── loader.ts
│   │   ├── handlebars.ts
│   │   ├── liquid.ts
│   │   └── ejs.ts
│   ├── llm/
│   │   ├── index.ts
│   │   ├── provider.ts
│   │   ├── openai.ts
│   │   ├── anthropic.ts
│   │   ├── ollama.ts
│   │   ├── openai-compatible.ts
│   │   └── tasks/
│   │       ├── summarize.ts
│   │       ├── enhance.ts
│   │       ├── categorize.ts
│   │       └── release-notes.ts
│   └── monorepo/
│       ├── aggregator.ts
│       └── splitter.ts
├── templates/
│   ├── keep-a-changelog/
│   │   ├── document.liquid
│   │   ├── version.liquid
│   │   └── entry.liquid
│   ├── angular/
│   │   ├── document.hbs
│   │   ├── version.hbs
│   │   └── entry.hbs
│   └── github-release/
│       └── release.md.ejs
├── test/
├── docs/
├── changelog.config.json
├── package.json
├── tsconfig.json
└── README.md
```

## Core Types

```typescript
// src/core/types.ts

/** Single changelog entry */
interface ChangelogEntry {
  type: 'added' | 'changed' | 'deprecated' | 'removed' | 'fixed' | 'security';
  description: string;
  issueIds?: string[];
  scope?: string;
  originalType?: string;
  breaking?: boolean;
}

/** Changelog for a single package version */
interface PackageChangelog {
  packageName: string;
  version: string;
  previousVersion: string | null;
  revisionRange: string;
  repoUrl: string | null;
  date: string;
  entries: ChangelogEntry[];
}

/** Full input data */
interface ChangelogInput {
  source: 'package-versioner' | 'conventional-changelog' | 'git-log' | 'manual';
  packages: PackageChangelog[];
  metadata?: {
    repoUrl?: string;
    defaultBranch?: string;
  };
}

/** Template context - what templates receive */
interface TemplateContext {
  packageName: string;
  version: string;
  previousVersion: string | null;
  date: string;
  repoUrl: string | null;
  entries: ChangelogEntry[];
  /** Only present if LLM processed */
  enhanced?: {
    entries: ChangelogEntry[];
    summary?: string;
    categories?: Record<string, ChangelogEntry[]>;
    releaseNotes?: string;
  };
}

/** Full document template context */
interface DocumentContext {
  project: {
    name: string;
    repoUrl?: string;
  };
  versions: TemplateContext[];
  unreleased?: TemplateContext;
}

/** LLM provider config */
interface LLMConfig {
  provider: string;
  model: string;
  baseURL?: string;
  apiKey?: string;
  options?: {
    timeout?: number;
    maxTokens?: number;
    temperature?: number;
  };
  tasks?: {
    summarize?: boolean;
    enhance?: boolean;
    categorize?: boolean;
    releaseNotes?: boolean;
  };
}

/** Output config */
interface OutputConfig {
  format: 'markdown' | 'github-release' | 'json';
  file?: string;
  options?: Record<string, unknown>;
}

/** Monorepo config */
interface MonorepoConfig {
  mode: 'root' | 'packages' | 'both';
  rootPath?: string;
  packagesPath?: string;
}

/** Full config */
interface Config {
  input?: {
    source?: string;
    file?: string;
  };
  output: OutputConfig[];
  monorepo?: MonorepoConfig;
  templates?: {
    path?: string;  // Single file OR directory
    engine?: 'handlebars' | 'liquid' | 'ejs';
  };
  llm?: LLMConfig;
  updateStrategy?: 'prepend' | 'regenerate';  // Default: 'prepend'
}
```

## Changelog Update Strategy

### Two Modes

**Prepend (default):**
- Adds new version block at top of existing changelog
- Preserves manual edits in older versions
- Faster (no git history traversal)
- Matches conventional-changelog behavior

**Regenerate:**
- Rebuilds entire changelog from all git tags
- Ensures consistent formatting
- Useful after template changes
- First-time setup

### CLI
```bash
changelog-creator                  # Prepend new version (default)
changelog-creator --regenerate     # Full regeneration
```

### Config
```json
{
  "updateStrategy": "prepend"
}
```

## Template System Design

### Two Modes

**1. Single-file template:**
```bash
--template ./my-changelog.liquid
```
Template receives `DocumentContext` and renders entire document.

**2. Composable templates:**
```bash
--template ./templates/  # Directory containing:
```
```
templates/
├── document.liquid  # Receives DocumentContext
├── version.liquid   # Receives TemplateContext (single version)
└── entry.liquid     # Receives ChangelogEntry
```

### Engine Detection
- By file extension: `.liquid`, `.hbs`, `.ejs`
- Or explicit: `--engine liquid`

### Default Templates
Built-in `keep-a-changelog`, `angular`, `github-release`

### Version Comparison Links

When `repoUrl` is available, templates receive pre-generated comparison URLs:

```typescript
interface TemplateContext {
  // ... existing fields
  compareUrl?: string;  // e.g., "https://github.com/org/repo/compare/v1.0.0...v1.1.0"
}

interface DocumentContext {
  // ... existing fields
  compareUrls?: Record<string, string>;  // version -> compare URL
}
```

**Supported platforms:**
- GitHub: `https://github.com/{owner}/{repo}/compare/{from}...{to}`
- GitLab: `https://gitlab.com/{owner}/{repo}/-/compare/{from}...{to}`
- Bitbucket: `https://bitbucket.org/{owner}/{repo}/branches/compare/{from}..{to}`

**Template usage:**
```liquid
## [{{ version }}] - {{ date }}
{% if compareUrl %}
[Full Changelog]({{ compareUrl }})
{% endif %}
```

## Configuration

### File Locations (precedence)
1. `CHANGELOG_CONFIG_CONTENT` env var
2. `--config` CLI flag
3. `changelog.config.json` / `changelog.config.jsonc` in project
4. `~/.config/changelog-creator/config.json`

### Auth Storage
`~/.config/changelog-creator/auth.json`

### Variable Substitution
- `{env:VAR_NAME}` - Environment variable
- `{file:path/to/file}` - File contents

### Example Config
```jsonc
{
  "$schema": "https://changelog-creator.dev/config.json",
  "output": [
    { "format": "markdown", "file": "CHANGELOG.md" }
  ],
  "monorepo": { "mode": "both" },
  "templates": {
    "path": "./templates/",
    "engine": "liquid"
  },
  "llm": {
    "provider": "openai-compatible",
    "model": "gpt-4o-mini",
    "baseURL": "{env:OPENAI_BASE_URL}",
    "apiKey": "{env:OPENAI_API_KEY}",
    "tasks": {
      "summarize": true,
      "enhance": true,
      "categorize": true,
      "releaseNotes": false
    }
  }
}
```

## Logging

Logging follows the same pattern as package-versioner for consistency.

### Log Levels

| Level | Flag | Output |
|-------|------|--------|
| error | (default) | Errors only |
| warn | | Errors + warnings |
| info | `-v` | Errors + warnings + info |
| debug | `-vv` | All above + debug details |
| trace | `-vvv` | All above + trace (internal operations) |

### Usage
```bash
changelog-creator                    # Default: errors only
changelog-creator -v                 # Info level
changelog-creator -vv                # Debug level
changelog-creator -vvv               # Trace level
changelog-creator --quiet            # Suppress all non-error output
```

### Implementation

```typescript
// src/utils/logging.ts
import { createLogger } from '@wdio/native-utils';  // Or copy pattern from package-versioner

const log = createLogger('changelog-creator', 'module-name');
```

Log format matches package-versioner:
```
[INFO] Processing 3 packages...
[DEBUG] Parsing input from stdin
[SUCCESS] Changelog written to CHANGELOG.md
[ERROR] Failed to create GitHub release: Unauthorized
```

## Error Handling

### Error Types

```typescript
// src/errors/index.ts

/** Base error class - matches package-versioner pattern */
abstract class ChangelogCreatorError extends Error {
  abstract readonly code: string;
  abstract readonly suggestions: string[];
  
  logError(): void {
    console.error(`[${this.code}] ${this.message}`);
    this.suggestions.forEach(s => console.error(`  • ${s}`));
  }
}

/** Input parsing errors */
class InputParseError extends ChangelogCreatorError {
  code = 'INPUT_PARSE_ERROR';
  suggestions = [
    'Ensure input is valid JSON',
    'Check that input matches expected schema',
    'Use --input-source to specify format'
  ];
}

/** Template errors */
class TemplateError extends ChangelogCreatorError {
  code = 'TEMPLATE_ERROR';
  suggestions = [
    'Check template syntax',
    'Ensure all required files exist (document, version, entry)',
    'Verify template engine matches file extension'
  ];
}

/** LLM errors */
class LLMError extends ChangelogCreatorError {
  code = 'LLM_ERROR';
  suggestions = [
    'Check API key is configured',
    'Verify model name is correct',
    'Check network connectivity',
    'Try with --no-llm to skip LLM processing'
  ];
}

/** GitHub API errors */
class GitHubError extends ChangelogCreatorError {
  code = 'GITHUB_ERROR';
  suggestions = [
    'Ensure GITHUB_TOKEN is set',
    'Check token has repo scope',
    'Verify repository exists and is accessible'
  ];
}

/** Configuration errors */
class ConfigError extends ChangelogCreatorError {
  code = 'CONFIG_ERROR';
  suggestions = [
    'Check config file syntax',
    'Verify all required fields are present',
    'Run changelog-creator init to create default config'
  ];
}
```

### Error Handling Strategy

1. **Catch at boundaries** - Each module catches its own errors and wraps in appropriate error class
2. **Provide suggestions** - Every error includes actionable suggestions
3. **Graceful degradation** - LLM failures fall back to raw data (with warning)
4. **Exit codes** - Different exit codes for different error types

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Config error |
| 3 | Input error |
| 4 | Template error |
| 5 | LLM error |
| 6 | GitHub API error |

## LLM Provider System

### Provider Interface
```typescript
interface LLMProvider {
  name: string;
  complete(prompt: string, options?: CompleteOptions): Promise<string>;
}
```

### Built-in Providers

| Provider | Config | Notes |
|----------|--------|-------|
| OpenAI | `provider: "openai"` | Official OpenAI API |
| Anthropic | `provider: "anthropic"` | Claude models |
| Ollama | `provider: "ollama"` | Local, default `localhost:11434` |
| OpenAI-Compatible | `provider: "openai-compatible"` | Any OpenAI-compatible endpoint |

### LLM Tasks (optional, off by default)

| Task | Input | Output |
|------|-------|--------|
| enhance | Single entry | Improved description |
| summarize | Multiple entries | Combined summary |
| categorize | All entries | Grouped by category |
| releaseNotes | All entries | Full release notes text |

## CLI Commands

```bash
# Generate changelog
changelog-creator [options]

# Initialize config
changelog-creator init

# Configure API key
changelog-creator auth <provider>

# List providers
changelog-creator providers
```

### Options
```
-i, --input <file>          Input file (default: stdin)
-o, --output <spec>         Output spec (format:file)
-t, --template <path>       Template file or directory
-e, --engine <engine>       Template engine
--monorepo <mode>           root|packages|both
--llm-provider <provider>   LLM provider
--llm-model <model>         LLM model
--llm-tasks <tasks>         Comma-separated tasks
--no-llm                    Disable LLM processing
--config <path>             Config file path
--dry-run                   Preview without writing
--regenerate                Regenerate entire changelog
-v, --verbose               Increase verbosity (info, debug, trace)
-q, --quiet                 Suppress non-error output
```

## Pipeline Flow

```
┌─────────────┐
│   Input     │  package-versioner JSON / git log / manual
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Parse     │  Normalize to ChangelogInput
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ LLM Process │  (optional) enhance → categorize → summarize
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Template   │  Render with context
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Output    │  markdown / github-release / json
└─────────────┘
```

## Implementation Phases

### Phase 1: Core Foundation
- [x] Repository setup (tsconfig, package.json)
- [x] Core types (`src/core/types.ts`)
- [x] Config loading with variable substitution
- [x] Auth file handling
- [x] Logging system (matches package-versioner pattern)
- [x] Error handling framework (error types, suggestions, exit codes)
- [x] package-versioner input parser
- [x] Basic markdown output (no templates yet)

### Phase 2: Template System
- [x] Template loader (single-file + composable detection)
- [x] Liquid engine
- [x] Handlebars engine
- [x] EJS engine
- [x] Built-in templates (keep-a-changelog, angular)
- [x] Template context construction
- [x] Version comparison link generation

### Phase 3: LLM Integration
- [x] Provider interface
- [x] OpenAI-compatible provider
- [x] Anthropic provider
- [x] Ollama provider
- [x] Task: enhance
- [x] Task: summarize
- [x] Task: categorize
- [x] Task: release-notes
- [x] Pipeline integration

### Phase 4: Monorepo Support
- [x] Root aggregation
- [x] Per-package splitting
- [x] Both mode

### Phase 5: GitHub Integration
- [x] GitHub Releases API output
- [x] Authentication (`GITHUB_TOKEN`)
- [x] Draft/prerelease support

### Phase 6: Additional Inputs
- [x] conventional-changelog parser
- [x] git-log parser
- [x] Manual JSON input

### Phase 7: CLI Polish
- [x] `init` command
- [x] `auth` command
- [x] `providers` command
- [x] Help text
- [x] Error messages

### Phase 8: Documentation & Testing
- [x] README
- [x] Provider docs
- [x] Template docs
- [x] Unit tests
- [x] Integration tests

## Dependencies

```json
{
  "dependencies": {
    "commander": "^14.0.0",
    "chalk": "^5.0.0",
    "liquidjs": "^10.0.0",
    "handlebars": "^4.7.0",
    "ejs": "^3.1.0",
    "zod": "^3.0.0",
    "openai": "^4.0.0",
    "@anthropic-ai/sdk": "^0.30.0",
    "@octokit/rest": "^21.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "vitest": "^3.0.0",
    "@types/node": "^22.0.0"
  }
}
```

## Testing Strategy

- Unit tests for each parser
- Unit tests for template engines
- Unit tests for LLM tasks (mocked responses)
- Integration tests with fixture data
- E2E test with wdio-desktop-mobile