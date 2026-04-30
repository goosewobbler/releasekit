# GitHub Releases

`@releasekit/publish` creates a GitHub Release for each published package. This guide covers configuration options and how to use LLM-generated prose as the release body.

## Enabling GitHub Releases

GitHub Releases are enabled by default. Requires `GITHUB_TOKEN` with `contents: write` permission.

```json
{
  "publish": {
    "githubRelease": {
      "enabled": true
    }
  }
}
```

To disable:

```json
{
  "publish": {
    "githubRelease": { "enabled": false }
  }
}
```

---

## Release Body (`body`)

Controls what appears in the GitHub Release description.

| Value | Behaviour |
|-------|-----------|
| `"auto"` (default) | Use LLM release notes if available, otherwise changelog entries, otherwise GitHub auto-generated notes |
| `"releaseNotes"` | Use LLM-generated prose release notes (requires `notes.releaseNotes.llm.tasks.releaseNotes: true`) |
| `"changelog"` | Use the formatted changelog entries for this version |
| `"generated"` | GitHub's auto-generated release notes (from merged PRs and commits) |
| `"none"` | No release body |

```json
{
  "publish": {
    "githubRelease": {
      "body": "releaseNotes"
    }
  }
}
```

---

## Using LLM-Generated Release Notes

To populate the GitHub Release body with LLM-written prose:

**1. Enable the `releaseNotes` LLM task in notes config:**

```json
{
  "notes": {
    "releaseNotes": {
      "llm": {
        "provider": "openai",
        "model": "gpt-4o-mini",
        "tasks": { "releaseNotes": true }
      }
    }
  },
  "publish": {
    "githubRelease": {
      "body": "releaseNotes"
    }
  }
}
```

The notes step runs first, the LLM generates prose release notes, and the publish step forwards them to the GitHub Release API.

If `body` is `"auto"` (default), LLM release notes are used automatically when available — no extra config needed.

**2. Optionally write release notes to a file** as well:

```json
{
  "notes": {
    "releaseNotes": {
      "mode": "root",
      "llm": {
        "provider": "anthropic",
        "model": "claude-haiku-4-5",
        "tasks": { "releaseNotes": true }
      }
    }
  }
}
```

When `mode` is set, a `RELEASE_NOTES.md` file is written in addition to the GitHub Release being populated.

---

## Draft Releases

Releases are created as drafts by default, giving you a chance to review before publishing.

```json
{
  "publish": {
    "githubRelease": {
      "draft": true
    }
  }
}
```

Set `"draft": false` to publish releases immediately.

---

## Prerelease Marking

```json
{
  "publish": {
    "githubRelease": {
      "prerelease": "auto"
    }
  }
}
```

| Value | Behaviour |
|-------|-----------|
| `"auto"` (default) | Marked as prerelease when the version contains a prerelease identifier (e.g. `1.0.0-beta.1`) |
| `true` | Always marked as prerelease |
| `false` | Never marked as prerelease |

---

## Release Title (`titleTemplate`)

Controls the title of each GitHub Release when a package name is resolved from the tag.

```json
{
  "publish": {
    "githubRelease": {
      "titleTemplate": "${packageName}: ${version}"
    }
  }
}
```

| Variable | Value |
|----------|-------|
| `${packageName}` | Original scoped package name, e.g. `@scope/pkg` |
| `${version}` | Version string extracted from the tag, e.g. `v1.0.0` |

The default produces titles like `@releasekit/version: v1.0.0`. Version-only tags (e.g. `v1.0.0` with no package prefix) always use the tag string directly.

---

## Per-Package Releases

In a monorepo, a separate GitHub Release is created for each published package by default.

```json
{
  "publish": {
    "githubRelease": {
      "perPackage": true
    }
  }
}
```

Set `"perPackage": false` to create a single release for the entire repo.

---

## Excluding Packages from GitHub Releases

Use `skipPackages` to suppress GitHub Release creation for specific packages while still running the full release process (version bump, commit, tag, npm publish) for them. This is useful for internal or utility packages that shouldn't appear in the GitHub Releases UI.

```json
{
  "publish": {
    "githubRelease": {
      "skipPackages": ["@my-org/internal-utils", "@my-org/build-tools"]
    }
  }
}
```

Tags are still created for skipped packages — this is required so that changelog range detection works correctly on the next release.

---

## Full Configuration Reference

```json
{
  "publish": {
    "githubRelease": {
      "enabled": true,
      "draft": true,
      "prerelease": "auto",
      "perPackage": true,
      "body": "auto",
      "titleTemplate": "${packageName}: ${version}",
      "skipPackages": []
    }
  }
}
```

See the [@releasekit/publish README](../README.md) for all options.
