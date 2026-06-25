# @releasekit/core

> [!WARNING]
> 🚧 **Pre-1.0.0** — ReleaseKit is evolving fast and **💥 breaking changes are common**; it's **🚫 not production-ready** until `v1.0.0`. 📌 Pin exact versions. See the [main README](../../README.md) for details.

Shared types and utilities for ReleaseKit packages.

## Overview

This is an internal package that defines the JSON contract between `@releasekit/version` (producer) and `@releasekit/notes` / `@releasekit/publish` (consumers). It is not intended for direct end-user consumption.

## Key Exports

### Types

| Type | Description |
|------|-------------|
| `VersionOutput` | Complete JSON output of `releasekit-version --json` |
| `VersionPackageUpdate` | A single package update record |
| `VersionPackageChangelog` | Changelog data for one package |
| `VersionChangelogEntry` | A single changelog entry |

### Error Handling

| Export | Description |
|--------|-------------|
| `ReleaseKitError` | Base error class for all ReleaseKit errors |
| `EXIT_CODES` | Standard exit codes for CLI tools |

### Logger Utilities

| Export | Description |
|--------|-------------|
| `setLogLevel(level)` | Set log level: `error`, `warn`, `info`, `debug`, `trace` |
| `setJsonMode(enabled)` | Enable JSON output mode |
| `setQuietMode(enabled)` | Suppress non-error output |

## Usage

```typescript
import { 
  VersionOutput, 
  VersionPackageUpdate, 
  ReleaseKitError 
} from '@releasekit/core';
```

## Installation

This package is typically installed as a dependency of other ReleaseKit packages:

```bash
pnpm add @releasekit/core
```

## Note

For end-user documentation, see:

- [@releasekit/version](../version/README.md) - Version management
- [@releasekit/publish](../publish/README.md) - Package publishing
- [@releasekit/notes](../notes/README.md) - Changelog generation

## License

MIT
