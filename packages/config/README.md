# @releasekit/config

Shared configuration loading and validation for ReleaseKit packages.

## Overview

This is an internal package that handles configuration loading, schema validation, and Cargo.toml parsing. It is used internally by all ReleaseKit packages and is not intended for direct end-user consumption.

## Key Exports

### Config Loading

| Export | Description |
|--------|-------------|
| `loadConfig(options)` | Load complete ReleaseKit config |
| `loadVersionConfig(options)` | Load version-specific config |
| `loadPublishConfig(options)` | Load publish-specific config |
| `loadNotesConfig(options)` | Load notes-specific config |
| `loadGitConfig(options)` | Load shared git config |
| `loadMonorepoConfig(options)` | Load monorepo config |

### Schema Types

| Export | Description |
|--------|-------------|
| `ReleaseKitConfig` | Complete config type |
| `ReleaseKitConfigSchema` | Zod schema for validation |
| `VersionConfig` | Version config type |
| `PublishConfig` | Publish config type |
| `NotesConfig` | Notes config type |

### Cargo Utilities

| Export | Description |
|--------|-------------|
| `parseCargoToml(path)` | Parse a `Cargo.toml` file and return a `CargoManifest` |
| `isCargoToml(filePath)` | Return `true` if the file is named `Cargo.toml` |
| `CargoManifest` | Type representing a parsed `Cargo.toml` |

### Utilities

| Export | Description |
|--------|-------------|
| `parseJsonc(content)` | Parse JSON with comments |
| `substituteInObject(obj)` | Substitute `{env:VAR}` and `{file:path}` |
| `deepMerge(target, source)` | Deep merge objects |
| `mergeGitConfig(top, pkg)` | Merge git config layers |

### Auth Utilities

| Export | Description |
|--------|-------------|
| `loadAuth()` | Load API keys from `~/.config/releasekit/auth.json` |
| `saveAuth(provider, key)` | Save API key securely |

### Error Handling

| Export | Description |
|--------|-------------|
| `ConfigError` | Configuration error class |

## Usage

```typescript
import { 
  loadConfig, 
  loadPublishConfig,
  parseJsonc,
  ConfigError 
} from '@releasekit/config';

// Load full config
const config = loadConfig({ cwd: process.cwd() });

// Load package-specific config
const publishConfig = loadPublishConfig();

// Parse JSONC
const data = parseJsonc('{ "key": "value" // comment\n}');
```

## Configuration File

ReleaseKit uses a single `releasekit.config.json` file:

```json
{
  "git": {
    "remote": "origin",
    "branch": "main"
  },
  "version": {
    "tagTemplate": "v{version}",
    "preset": "conventional"
  },
  "publish": {
    "npm": {
      "enabled": true,
      "access": "public"
    }
  },
  "notes": {
    "output": [{ "format": "markdown", "file": "CHANGELOG.md" }]
  }
}
```

JSONC (JSON with comments) is supported.

## Installation

This package is typically installed as a dependency of other ReleaseKit packages:

```bash
pnpm add @releasekit/config
```

## Note

For end-user documentation, see:

- [@releasekit/version](../version/README.md) - Version management
- [@releasekit/publish](../publish/README.md) - Package publishing
- [@releasekit/notes](../notes/README.md) - Changelog generation

## License

MIT
