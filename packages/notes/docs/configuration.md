# Notes Configuration Reference

All options live under the `notes` key in `releasekit.config.json`. Add `$schema` for editor autocompletion:

```json
{
  "$schema": "https://goosewobbler.github.io/releasekit/schema.json",
  "notes": {}
}
```

---

## `notes.changelog`

Controls whether and where changelog files are written.

**Type:** `false | object`
**Default:** generates `CHANGELOG.md` at the repo root

Set to `false` to disable changelog generation entirely.

```json
{
  "notes": {
    "changelog": false
  }
}
```

When an object, the following properties are available:

### `notes.changelog.mode`

| Value | Behaviour |
|-------|-----------|
| `"root"` | Write a single changelog at the repo root (default) |
| `"packages"` | Write one changelog per package inside each package directory |
| `"both"` | Write both root and per-package changelogs |

```json
{
  "notes": {
    "changelog": { "mode": "packages" }
  }
}
```

### `notes.changelog.file`

Override the changelog file name.

**Type:** `string`
**Default:** `"CHANGELOG.md"`

```json
{
  "notes": {
    "changelog": { "mode": "root", "file": "CHANGES.md" }
  }
}
```

### `notes.changelog.templates`

Custom template for changelog rendering.

| Property | Type | Description |
|----------|------|-------------|
| `path` | `string` | Path to a template file or directory |
| `engine` | `"handlebars" \| "liquid" \| "ejs"` | Template engine |

```json
{
  "notes": {
    "changelog": {
      "mode": "root",
      "templates": {
        "path": "./templates/changelog/",
        "engine": "liquid"
      }
    }
  }
}
```

See the [templates guide](./templates.md) for authoring details.

---

## `notes.releaseNotes`

Controls release notes generation. Release notes are a separate output from the changelog — typically prose-formatted and suitable for GitHub release bodies.

**Type:** `false | object`
**Default:** `undefined` (release notes not generated)

Set to `false` to explicitly disable when it has been enabled via config inheritance.

When an object with a `mode` or `file` property, release notes are written to a file. When only `llm` is present (no `mode`/`file`), the LLM runs but no file is written — the generated content is passed to the publish step for use as a GitHub release body.

### `notes.releaseNotes.mode`

| Value | Behaviour |
|-------|-----------|
| `"root"` | Write `RELEASE_NOTES.md` at the repo root |
| `"packages"` | Write one release notes file per package |
| `"both"` | Write both root and per-package files |

### `notes.releaseNotes.file`

Override the release notes file name.

**Type:** `string`
**Default:** `"RELEASE_NOTES.md"`

### `notes.releaseNotes.templates`

Same structure as `notes.changelog.templates`. See the [templates guide](./templates.md).

### `notes.releaseNotes.llm`

LLM configuration for release notes enhancement. Requires `provider` and `model`.

```json
{
  "notes": {
    "releaseNotes": {
      "llm": {
        "provider": "openai",
        "model": "gpt-4o-mini",
        "tasks": { "enhance": true, "summarize": true }
      }
    }
  }
}
```

See the full LLM option reference below.

---

## `notes.updateStrategy`

How existing changelog files are updated when new entries are generated.

**Type:** `"prepend" | "regenerate"`
**Default:** `"prepend"`

| Value | Behaviour |
|-------|-----------|
| `"prepend"` | New entries are inserted at the top of the existing file |
| `"regenerate"` | The entire file is rewritten from scratch using all available history |

```json
{
  "notes": {
    "updateStrategy": "regenerate"
  }
}
```

---

## LLM options (`notes.releaseNotes.llm`)

### Required

| Option | Type | Description |
|--------|------|-------------|
| `provider` | `string` | LLM provider key. See [LLM providers](./llm-providers.md). |
| `model` | `string` | Model identifier (e.g. `"gpt-4o-mini"`, `"claude-sonnet-4-5"`) |

### Connection

| Option | Type | Description |
|--------|------|-------------|
| `baseURL` | `string` | Custom API base URL (for `openai-compatible` providers) |
| `apiKey` | `string` | API key inline. Prefer env var or `releasekit-notes auth` over this. |

### Behaviour

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `concurrency` | `integer` | `3` | Maximum parallel LLM requests when enhancing entries |

### Model options (`options`)

| Option | Type | Description |
|--------|------|-------------|
| `timeout` | `integer` (ms) | Request timeout |
| `maxTokens` | `integer` | Maximum tokens to generate |
| `temperature` | `number` | Sampling temperature (0–2) |

```json
{
  "llm": {
    "provider": "openai",
    "model": "gpt-4o",
    "options": { "temperature": 0.3, "maxTokens": 1000 }
  }
}
```

### Tasks (`tasks`)

| Task | Type | Description |
|------|------|-------------|
| `enhance` | `boolean` | Rewrite each entry description to be clearer and more user-facing |
| `summarize` | `boolean` | Generate a one-paragraph summary of the release |
| `categorize` | `boolean` | Group entries into user-friendly categories (Features, Fixes, …) |
| `releaseNotes` | `boolean` | Generate full prose release notes suitable for a GitHub release body |

### Categories (`categories`)

Provide hints to the `categorize` task for how to group entries.

```json
{
  "llm": {
    "tasks": { "categorize": true },
    "categories": [
      { "name": "Features", "description": "New user-facing functionality" },
      { "name": "Bug Fixes", "description": "Corrections to existing behaviour" },
      { "name": "Performance", "description": "Speed or resource improvements" }
    ]
  }
}
```

Each category object:

| Field | Required | Description |
|-------|----------|-------------|
| `name` | yes | Display name used in template rendering |
| `description` | yes | Hint sent to the LLM to guide grouping |
| `scopes` | no | Commit scopes that always map to this category |

### Style (`style`)

A brief style instruction appended to every LLM prompt.

```json
{
  "llm": {
    "style": "Use concise, non-technical language suitable for end users."
  }
}
```

### Retry (`retry`)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxAttempts` | `integer` | `3` | Maximum retries on failure |
| `initialDelay` | `integer` (ms) | `500` | Delay before first retry |
| `maxDelay` | `integer` (ms) | `10000` | Maximum delay between retries |
| `backoffFactor` | `number` | `2` | Exponential backoff multiplier |

### Prompt overrides (`prompts`)

Override the built-in prompt instructions or templates for any task. The key is the task name (`enhance`, `categorize`, `summarize`, `releaseNotes`).

```json
{
  "llm": {
    "prompts": {
      "instructions": {
        "enhance": "Rewrite the description from a developer's perspective, keeping it technical."
      }
    }
  }
}
```

See the [LLM providers guide](./llm-providers.md) for examples.
