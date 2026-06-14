# Monorepo Support

`@releasekit/notes` writes the **changelog** at the repo root, inside each package directory, or both. **Release notes** are a separate artifact: they default to the GitHub release body, with opt-in per-version files that nest by package in a monorepo.

## Changelog Modes

| Mode | Changelog written to |
|------|----------------------|
| `"root"` | `<repo-root>/CHANGELOG.md` |
| `"packages"` | `packages/<name>/CHANGELOG.md` (each package) |
| `"both"` | Both root and per-package |

## Release Notes Files

Release notes don't use changelog modes. They go to the GitHub release body by default; set `releaseNotes.file.dir` for opt-in in-repo files, written one **per version** and nested by package:

```json
{
  "notes": {
    "changelog": { "mode": "packages" },
    "releaseNotes": { "file": { "dir": "release-notes" } }
  }
}
```

```
release-notes/
  @myorg/core/2.0.0.md
  utils/1.1.0.md
```

---

## Root Changelog (aggregated)

In `"root"` or `"both"` mode, the root changelog aggregates entries from all packages. Packages with a `@scope/` prefix include the package name in the version header:

```markdown
## [@myorg/core@2.0.0] — 2026-03-15

### Added
- New streaming API

## [utils@1.1.0] — 2026-03-15

### Fixed
- Memory leak in event handler
```

Unscoped packages omit the name:

```markdown
## [2.0.0] — 2026-03-15
```

---

## Per-Package Changelogs

In `"packages"` or `"both"` mode, a separate changelog is written inside each package directory. The path is determined by the package's location in the workspace.

Custom file name applies to all packages:

```json
{
  "notes": {
    "changelog": { "mode": "packages", "file": "CHANGES.md" }
  }
}
```

---

## CLI Flags

Use `--changelog-mode` to override the changelog location, and `--release-notes-dir` to write per-version release-notes files:

```bash
# Root changelog only
releasekit-notes --changelog-mode root

# Per-package changelogs
releasekit-notes --changelog-mode packages

# Both
releasekit-notes --changelog-mode both

# Use --monorepo as a shorthand for the changelog mode
releasekit-notes --monorepo packages

# Per-version release-notes files
releasekit-notes --release-notes-dir release-notes
```

`--monorepo` sets the changelog mode (release notes use a per-version directory, not modes). An explicit `--changelog-mode` takes priority over `--monorepo` when both are present.

---

## Monorepo Path Configuration

Package locations are detected automatically from your workspace configuration (`pnpm-workspace.yaml`, `package.json` workspaces). To override root or packages directory paths, use the top-level `monorepo` config:

```json
{
  "monorepo": {
    "rootPath": ".",
    "packagesPath": "packages"
  },
  "notes": {
    "changelog": { "mode": "both" }
  }
}
```

---

## LLM with Monorepo

LLM tasks run per-package. Each package's entries are processed independently. With concurrency set, multiple packages can be processed in parallel:

```json
{
  "notes": {
    "changelog": { "mode": "packages" },
    "releaseNotes": {
      "llm": {
        "provider": "openai",
        "model": "gpt-4o-mini",
        "concurrency": 5,
        "tasks": { "enhance": true }
      }
    }
  }
}
```
