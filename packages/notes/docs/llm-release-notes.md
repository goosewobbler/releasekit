# LLM-Enhanced Release Notes

The LLM pipeline transforms raw conventional commit entries into polished, user-readable release notes. It can rewrite entry descriptions for clarity, group them into semantic categories, generate scannable `leadIn` phrases for notable features, automatically route breaking changes, and produce full prose release notes suitable for a GitHub release body. See [LLM providers](./llm-providers.md) for provider setup and authentication.

---

## Setup

Add an `llm` block under `notes.releaseNotes` in `releasekit.config.json`:

```json
{
  "notes": {
    "releaseNotes": {
      "llm": {
        "provider": "openai",
        "model": "gpt-4o-mini",
        "tasks": { "enhance": true, "categorize": true }
      }
    }
  }
}
```

> Without a `mode` or `file` property on `releaseNotes`, no file is written — the generated content is passed directly to the publish step (e.g. as a GitHub release body). Add `"mode": "root"` to also write a `RELEASE_NOTES.md` file.

---

## What the LLM changes

Without LLM, the built-in renderer groups entries by their conventional commit type:

```markdown
## [2.0.0] - 2026-01-15

### Changed
- rename connect() to initialize() across public API

### Added
- add triggerDeeplink() for deep link testing
- add mock IPC handler support

### Fixed
- null pointer in renderer process memory management
```

With `enhance + categorize` enabled, the same commits produce:

```markdown
## [2.0.0] - 2026-01-15

### Breaking
- **BREAKING** **API rename**: Rename connect() to initialize()

### New
**ipc**:
- **Deeplink testing**: Add deep link support via triggerDeeplink()
- Add mock IPC support

### Fixed
- Resolve memory leak in renderer process
```

The LLM rewrites descriptions, groups by user intent instead of commit type, generates scannable `leadIn` phrases for notable entries, and routes breaking changes to a dedicated section.

---

## Tasks

Four tasks are available. Any combination can be enabled simultaneously.

| Task | What it does | Output location |
|------|-------------|-----------------|
| `enhance` | Rewrites entry descriptions to be clear and user-facing | `entries[].description` (replaced in-place) |
| `categorize` | Groups entries into semantic categories | `enhanced.categories` in template context |
| `summarize` | Generates a 2–3 sentence release summary | `enhanced.summary` in template context |
| `releaseNotes` | Writes full prose markdown release notes | `enhanced.releaseNotes` / pipeline result |

**Recommended starting point:** Enable `enhance` and `categorize` together. This is the most impactful combination — rewriting and grouping both happen in a single LLM call, and it also unlocks `leadIn` phrases, scope grouping, and breaking change re-routing in the built-in renderer. Add `summarize` or `releaseNotes` when you want prose output for GitHub releases.

> **Efficiency tip:** When both `enhance` and `categorize` are enabled, the pipeline makes a **single combined LLM call** (`enhanceAndCategorize`) instead of two sequential calls. This combined path also produces `leadIn` phrases and scope assignments, which are not available when running `enhance` alone.

---

## Task: `enhance`

Rewrites each changelog entry description to be clear, concise, and user-focused.

**Input:** `"fix: npe in auth middleware when token is null"`
**Output:** `"Fix crash during authentication when no token is provided"`

Entries are processed in parallel. Control the batch size with `concurrency` (default: `5`):

```json
{ "concurrency": 3 }
```

> **Note:** `leadIn` phrases, scope assignments, and breaking flags are only generated when `enhance` is combined with `categorize` (the combined `enhanceAndCategorize` path). Running `enhance` alone rewrites descriptions only — see [Combined enhance + categorize](#combined-enhance--categorize).

---

## Task: `categorize`

Groups entries into user-friendly categories. The result populates `enhanced.categories` in the template context and drives the built-in markdown renderer's section layout.

### Default categories

When `categories` is not configured, the following defaults are used:

| Name | Description |
|------|-------------|
| `Breaking` | Breaking changes that require user action to upgrade |
| `New` | New features and capabilities |
| `Changed` | Changes to existing functionality |
| `Fixed` | Bug fixes |
| `Developer` | Internal changes: CI, tooling, dependencies, refactoring |

The LLM is constrained to these exact names. If the model returns an invalid category, the pipeline sends a follow-up message pointing out the error and asking it to revise — this is called a corrective retry. If all retries are exhausted, all entries are placed in a single `"General"` fallback category.

### Custom categories

Override the defaults by providing your own category list (shown as `notes.releaseNotes.llm` fragment):

```json
{
  "tasks": { "categorize": true },
  "categories": [
    { "name": "Features", "description": "New user-facing functionality" },
    { "name": "Bug Fixes", "description": "Corrections to existing behaviour" },
    { "name": "Under the Hood", "description": "Internal changes users may not notice" }
  ]
}
```

Each category object:

| Field | Required | Description |
|-------|----------|-------------|
| `name` | yes | Display name used in section headers |
| `description` | yes | Hint sent to the LLM to guide grouping |
| `scopes` | no | Scope values that always map to this category |

### Category order

Control the render order with `categoryOrder`. Categories not in the list appear after the listed ones. The `Breaking` category always pins first even if omitted.

```json
{
  "llm": {
    "categoryOrder": ["Breaking", "New", "Fixed", "Changed", "Developer"]
  }
}
```

---

## Task: `summarize`

Generates a 2–3 sentence summary of the entire release. The result is available as `enhanced.summary` in the template context.

```json
{ "tasks": { "summarize": true } }
```

---

## Task: `releaseNotes`

Generates complete prose markdown release notes for the version — suitable for a GitHub release body. The result is available as `enhanced.releaseNotes` in the pipeline result, and is used automatically when `publish.githubRelease.body` is set to `"releaseNotes"`.

```json
{ "tasks": { "releaseNotes": true } }
```

No `mode` or `file` is required for this task — the generated text is passed through the pipeline even without file output.

---

## Combined enhance + categorize

When both `enhance: true` and `categorize: true` are set, the pipeline runs a single `enhanceAndCategorize` call that returns:

- Rewritten `description` for each entry
- Assigned `category`
- Assigned `scope` (or `null`)
- `breaking` flag (or `null`)
- `leadIn` phrase (or `null`)

This is more efficient than two sequential calls and produces richer output. Use the `enhanceAndCategorize` key in `prompts.instructions` to customise this combined call — the standalone `enhance` key applies only when `categorize` is disabled:

```json
{
  "llm": {
    "prompts": {
      "instructions": {
        "enhanceAndCategorize": "Prefer 'New' over 'Changed' for purely additive changes.",
        "enhance": "This applies only when categorize is disabled."
      }
    }
  }
}
```

---

## Breaking change handling

Any entry where `breaking: true` is set — whether from the source input or flagged by the LLM during enhancement — is automatically moved to a `Breaking` category by the built-in markdown renderer at render time, regardless of which category the LLM assigned it to. If no `Breaking` category exists, one is created and prepended before all other categories.

This happens in the renderer, not during the LLM call, so custom templates receive the raw data and must implement breaking-change handling themselves if needed.

Rendered format:
- With `leadIn`: `- **BREAKING** **API rename**: Rename connect() to initialize()`
- Without `leadIn`: `- **BREAKING** Rename connect() to initialize()`

---

## `leadIn` phrases

When running the combined `enhanceAndCategorize` task, the LLM generates a `leadIn` phrase for notable entries — a short noun phrase (e.g. `"Streaming API"`, `"Deeplink testing"`) that makes the entry scannable at a glance.

The LLM sets `leadIn` only for entries that introduce a named API, feature, or concept. Routine fixes, dependency bumps, and internal refactors receive `null` and render without a prefix.

Rendered format:
- With `leadIn`: `- **Deeplink testing**: Add deep link support via triggerDeeplink()`
- Without `leadIn`: `- Add mock IPC support`
- With `leadIn` + `breaking`: `- **BREAKING** **API rename**: Rename connect() to initialize()`

The `leadIn` value is available in templates as `entry.leadIn` (may be `undefined`).

---

## Scope grouping

When the built-in markdown renderer encounters a category where **two or more entries share the same scope**, it groups them under a bold scope header instead of repeating the scope on each bullet:

```markdown
### New
**ipc**:
- **Deeplink testing**: Add deep link support via triggerDeeplink()
- Add mock IPC support
```

A scope that appears on only one entry renders inline: `- **scope**: description`. Entries with no scope render as plain bullets.

Scope is assigned by the LLM (or inherited from the source commit). Control what scopes are valid with the `scopes` config.

---

## Scope validation (`scopes`)

Controls how the LLM assigns scopes to entries.

| Mode | Behaviour |
|------|-----------|
| `unrestricted` | LLM assigns any scope it chooses (default) |
| `none` | Scopes are disabled; all assigned scopes are cleared |
| `restricted` | Only scopes in `rules.allowed` are permitted |
| `packages` | Scopes must match package names (monorepo only) |

```json
{
  "llm": {
    "scopes": {
      "mode": "restricted",
      "rules": {
        "allowed": ["api", "ui", "core"],
        "caseSensitive": false
      }
    }
  }
}
```

Invalid scopes trigger a corrective retry — the LLM is told which scopes are valid and asked to revise its response. After all retry attempts are exhausted, the invalid scope is cleared rather than causing a failure.

---

## PR body context (`context.pullRequests`)

When `context.pullRequests` is `true` (the default), the pipeline fetches the body of each linked pull request from GitHub and includes it in the LLM prompt. This gives the LLM additional context — PR descriptions, linked issues, migration notes — for writing accurate enhanced entries.

Requires `GITHUB_TOKEN` or `GH_TOKEN`. If no token is available, PR fetching is silently skipped and a warning is logged.

Set to `false` to disable:

```json
{ "context": { "pullRequests": false } }
```

---

## Few-shot examples (`examples`)

The pipeline fetches up to `examples` (default: `3`) past GitHub releases and includes them in the LLM prompt as style references. The LLM uses the format and tone of prior releases to make new output consistent with your project's history.

```json
{ "examples": 5 }
```

Allowable range: `0`–`5`. Set to `0` to disable. Requires `GITHUB_TOKEN` or `GH_TOKEN` and a valid `repoUrl` in the input. Fetching is skipped silently if neither is available.

---

## Writing style (`style`)

The `style` string is appended to every LLM prompt as a style instruction. Default:

```
Write in past tense ("Added feature", not "Add feature"). Be concise and user-focused. Lead with the impact, not the implementation detail.
```

Override to change tone or focus:

```json
{
  "llm": {
    "style": "Use friendly language for non-technical users. Keep entries under 15 words."
  }
}
```

---

## Links section (`notes.releaseNotes.links`)

The built-in renderer can append a links section at the bottom of each release. This section is only rendered when LLM categorisation is active (`tasks.categorize: true`).

Two sources of links can be combined:

- **`items`** — static label/URL pairs hardcoded in config
- **`fromPRBodyMarker`** — scans all linked PR bodies for lines starting with the marker string and extracts markdown links or bare URLs from them

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

Rendered output:

```markdown
### Migration guide
- [v2.0 migration](https://docs.example.com/migrate-v2)
- [Full guide](https://docs.example.com/full-guide)
```

Links are de-duplicated by URL. Explicit `items` take precedence over discovered links. The `title` defaults to `"Links"` if not set.

---

## Prompt customisation

Override the built-in prompt instructions for any task using `prompts.instructions`. The string is appended to the relevant system prompt.

```json
{
  "llm": {
    "prompts": {
      "instructions": {
        "enhance": "Write from the perspective of an end user, not a developer.",
        "enhanceAndCategorize": "Prefer 'New' over 'Changed' for additive changes. Flag any database migrations as breaking.",
        "categorize": "When enhance is disabled, this key applies to the standalone categorize call.",
        "summarize": "Write a single sentence, not a paragraph.",
        "releaseNotes": "Start with a one-sentence executive summary, then group changes by theme."
      }
    }
  }
}
```

Key clarification: `enhanceAndCategorize` applies when **both** `enhance: true` and `categorize: true` are set (the combined single-call path). The `enhance` key applies only when `categorize` is disabled.

---

## Error handling and fallback

The LLM pipeline is designed to be non-blocking. All failures are handled gracefully:

| Failure | Behaviour |
|---------|-----------|
| Provider unreachable, auth error, or unexpected exception | Warning logged; pipeline falls back to non-LLM rendering (type-based grouping) |
| Categorisation fails after all corrective retries | All entries placed in a single `"General"` category |
| Individual `enhance` entry fails | Original entry description preserved for that entry |
| Scope validation fails after all retries | Invalid scope cleared; entry rendered without scope |

Set `RELEASEKIT_DEBUG=1` for verbose LLM request/response logging.

---

## Full example

### Input entries

```
refactor!: rename connect() to initialize() across public API
feat(ipc): add triggerDeeplink() for deep link testing
feat(ipc): add mock IPC handler support
fix: null pointer in renderer process memory management
chore: migrate bundler from webpack to esbuild 0.20
```

### Config

```json
{
  "notes": {
    "releaseNotes": {
      "llm": {
        "provider": "anthropic",
        "model": "claude-haiku-4-5",
        "tasks": { "enhance": true, "categorize": true },
        "categoryOrder": ["Breaking", "New", "Fixed", "Changed", "Developer"]
      },
      "links": {
        "fromPRBodyMarker": "Migration:",
        "items": [{ "label": "v2.0 migration guide", "url": "https://docs.example.com/migrate-v2" }]
      }
    }
  }
}
```

Note that `links` is a property of `releaseNotes`, not `llm`.

### Rendered output

```markdown
## [2.0.0] - 2026-01-15

### Breaking
- **BREAKING** **API rename**: Rename connect() to initialize()

### New
**ipc**:
- **Deeplink testing**: Add deep link support via triggerDeeplink()
- Add mock IPC support

### Fixed
- Resolve memory leak in renderer process

### Developer
- Migrate bundler to esbuild 0.20

### Links
- [v2.0 migration guide](https://docs.example.com/migrate-v2)
```

**What happened:**
- The `refactor!` commit has `breaking: true`, so it was re-routed to `Breaking` regardless of the LLM's original category. The `leadIn` phrase `"API rename"` was generated because it introduces a named API change.
- The two `feat(ipc)` commits share the `ipc` scope, so they're grouped under a `**ipc**:` header. The first gets a `leadIn` (`"Deeplink testing"`); the second is a routine addition and gets none.
- The `fix` commit maps to `Fixed` with no scope or `leadIn` (routine fix).
- The `chore` commit maps to `Developer` (internal tooling change).
- The static link from `items` is appended under `### Links`.
