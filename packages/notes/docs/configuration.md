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

See the [full LLM option reference](#llm-options-notesreleasenotesllm) below.

### `notes.releaseNotes.links`

Appends a links section to each release in the built-in markdown renderer. Only rendered when LLM categorisation is active (`tasks.categorize: true`).

| Option | Type | Description |
|--------|------|-------------|
| `title` | `string` | Section heading. Default: `"Links"` |
| `items` | `object[]` | Static links: `{ label: string, url: string }` |
| `fromPRBodyMarker` | `string` | Scan PR bodies for lines beginning with this marker and extract markdown links or bare URLs |

```json
{
  "notes": {
    "releaseNotes": {
      "links": {
        "title": "Migration guide",
        "items": [
          { "label": "v2.0 migration", "url": "https://docs.example.com/migrate-v2" }
        ],
        "fromPRBodyMarker": "Migration:"
      }
    }
  }
}
```

Links discovered via `fromPRBodyMarker` are de-duplicated against explicit `items` by URL (explicit `items` take precedence).

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
| `concurrency` | `integer` | `5` | Maximum parallel LLM requests when enhancing entries |
| `examples` | `integer` | `3` | Past GitHub releases to fetch for few-shot style prompting (`0`–`5`; requires `GITHUB_TOKEN`) |

### Context (`context`)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `context.pullRequests` | `boolean` | `true` | Fetch linked PR bodies from GitHub for extra LLM context. Requires `GITHUB_TOKEN` or `GH_TOKEN`. |

### Model options (`options`)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `timeout` | `integer` (ms) | `60000` | Request timeout |
| `maxTokens` | `integer` | `16384` | Maximum tokens to generate |
| `temperature` | `number` | `0.7` | Sampling temperature (0–2) |

```json
{
  "notes": {
    "releaseNotes": {
      "llm": {
        "provider": "openai",
        "model": "gpt-4o",
        "options": { "temperature": 0.3, "maxTokens": 1000 }
      }
    }
  }
}
```

### Tasks (`tasks`)

| Task | Type | Description |
|------|------|-------------|
| `enhance` | `boolean` | Rewrite each entry description to be clearer and more user-facing |
| `summarize` | `boolean` | Generate a one-paragraph summary of the release |
| `categorize` | `boolean` | Group entries into semantic categories (default set: Breaking, New, Changed, Fixed, Developer) |
| `releaseNotes` | `boolean` | Generate full prose release notes suitable for a GitHub release body |

### Categories (`categories`)

Controls how the `categorize` task groups entries. When not set, the following defaults are used:

| Name | Description |
|------|-------------|
| `Breaking` | Breaking changes that require user action to upgrade |
| `New` | New features and capabilities |
| `Changed` | Changes to existing functionality |
| `Fixed` | Bug fixes |
| `Developer` | Internal changes: CI, tooling, dependencies, refactoring |

Override with a custom list:

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

### Category order (`categoryOrder`)

Controls the order in which LLM-categorised sections are rendered. Categories not listed appear after the listed ones. The `Breaking` category is always pinned first even if omitted from this list.

**Type:** `string[]`
**Default:** none (LLM-returned order is preserved)

```json
{
  "llm": {
    "categoryOrder": ["Breaking", "New", "Fixed", "Changed", "Developer"]
  }
}
```

### Scope validation (`scopes`)

Controls how the LLM assigns scopes to entries. Invalid scopes trigger a corrective retry; after all retries are exhausted the scope is cleared rather than causing a failure.

**`scopes.mode`**

| Value | Behaviour |
|-------|-----------|
| `unrestricted` | LLM assigns any scope it chooses (default) |
| `none` | Scopes are disabled; all assigned scopes are cleared |
| `restricted` | Only scopes in `rules.allowed` are permitted |
| `packages` | Scopes must match package names (monorepo only) |

**`scopes.rules`**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `allowed` | `string[]` | — | Allowed scope values when mode is `restricted` |
| `caseSensitive` | `boolean` | `false` | Whether scope matching is case-sensitive |

```json
{
  "llm": {
    "scopes": {
      "mode": "restricted",
      "rules": { "allowed": ["api", "ui", "core"] }
    }
  }
}
```

### Style (`style`)

A style instruction appended to every LLM prompt.

Default:
```
Write in present tense ("Add feature", not "Added feature"). Be concise and user-focused. Lead with the impact, not the implementation detail.
```

Override to change tone:

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
| `initialDelay` | `integer` (ms) | `1000` | Delay before first retry |
| `maxDelay` | `integer` (ms) | `30000` | Maximum delay between retries |
| `backoffFactor` | `number` | `2` | Exponential backoff multiplier |

### Prompt overrides (`prompts`)

`prompts.instructions` appends extra text to the built-in system prompt for a task. The structured output contract is preserved, so this is safe to use with all tasks.

Available keys:

| Key | Applies to |
|-----|-----------|
| `enhance` | Standalone `enhance` task (when `categorize` is disabled) |
| `categorize` | Standalone `categorize` task (when `enhance` is disabled) |
| `enhanceAndCategorize` | Combined task (when both `enhance` and `categorize` are enabled) |
| `summarize` | `summarize` task |
| `releaseNotes` | `releaseNotes` task |

```json
{
  "notes": {
    "releaseNotes": {
      "llm": {
        "prompts": {
          "instructions": {
            "enhance": "Write from the perspective of an end user, not a developer.",
            "releaseNotes": "Start with a one-sentence executive summary."
          }
        }
      }
    }
  }
}
```

See the [LLM providers guide](./llm-providers.md) for more examples.
