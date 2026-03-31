# Monorepo Support

`@releasekit/notes` can write changelogs and release notes at the repo root, inside each package directory, or both — controlled independently for changelog and release notes output.

## Output Modes

| Mode | Changelog written to | Release notes written to |
|------|---------------------|--------------------------|
| `"root"` | `<repo-root>/CHANGELOG.md` | `<repo-root>/RELEASE_NOTES.md` |
| `"packages"` | `packages/<name>/CHANGELOG.md` (each package) | `packages/<name>/RELEASE_NOTES.md` |
| `"both"` | Both root and per-package | Both root and per-package |

Set `mode` on `changelog` and `releaseNotes` independently:

```json
{
  "notes": {
    "changelog": { "mode": "packages" },
    "releaseNotes": { "mode": "root" }
  }
}
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

Use `--changelog-mode` / `--release-notes-mode` to override config:

```bash
# Root changelog only
releasekit-notes --changelog-mode root

# Per-package changelogs
releasekit-notes --changelog-mode packages

# Both outputs
releasekit-notes --changelog-mode both

# Use --monorepo as a shorthand (applies to both outputs)
releasekit-notes --monorepo packages
```

When `--monorepo` is set, it applies to both `changelog` and `releaseNotes` modes. Explicit `--changelog-mode` or `--release-notes-mode` flags take priority over `--monorepo` when both are present.

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
