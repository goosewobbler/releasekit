# LLM Providers

`@releasekit/notes` can use an LLM to enhance changelog entries, generate summaries, or produce prose release notes. All LLM configuration lives under `notes.releaseNotes.llm` in `releasekit.config.json`.

## Supported Providers

| Provider key | Service | Auth |
|---|---|---|
| `openai` | OpenAI (GPT models) | `OPENAI_API_KEY` |
| `anthropic` | Anthropic (Claude models) | `ANTHROPIC_API_KEY` |
| `ollama` | Ollama (local models) | None |
| `openai-compatible` | Any OpenAI-compatible endpoint | Varies |

---

## Storing API Keys

Use the `auth` subcommand to store API keys securely in `~/.config/releasekit/auth.json`:

```bash
# Interactive prompt
releasekit-notes auth openai
releasekit-notes auth anthropic

# Pass key directly
releasekit-notes auth openai --key sk-...
```

Alternatively, set the provider's environment variable (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.). Environment variables take precedence over stored keys.

---

## Provider Setup

### OpenAI

```json
{
  "notes": {
    "releaseNotes": {
      "llm": {
        "provider": "openai",
        "model": "gpt-4o-mini",
        "tasks": { "enhance": true }
      }
    }
  }
}
```

Set `OPENAI_API_KEY` or run `releasekit-notes auth openai`.

Recommended models: `gpt-4o-mini` (fast, cheap), `gpt-4o` (higher quality).

### Anthropic

```json
{
  "notes": {
    "releaseNotes": {
      "llm": {
        "provider": "anthropic",
        "model": "claude-haiku-4-5",
        "tasks": { "releaseNotes": true }
      }
    }
  }
}
```

Set `ANTHROPIC_API_KEY` or run `releasekit-notes auth anthropic`.

Recommended models: `claude-haiku-4-5` (fast), `claude-sonnet-4-5` (balanced).

### Ollama (local)

Ollama runs entirely on your machine — no API key required.

```bash
# Pull a model first
ollama pull llama3.2
```

```json
{
  "notes": {
    "releaseNotes": {
      "llm": {
        "provider": "ollama",
        "model": "llama3.2",
        "tasks": { "enhance": true }
      }
    }
  }
}
```

Ollama defaults to `http://localhost:11434`. Override with `baseURL` if needed.

### OpenAI-Compatible Endpoint

For self-hosted or third-party OpenAI-compatible APIs (LM Studio, vLLM, Azure OpenAI, etc.):

```json
{
  "notes": {
    "releaseNotes": {
      "llm": {
        "provider": "openai-compatible",
        "model": "mistral-7b-instruct",
        "baseURL": "http://localhost:1234/v1",
        "tasks": { "enhance": true }
      }
    }
  }
}
```

Set `baseURL` to the endpoint's base path. If the endpoint requires authentication, set `apiKey` in the config or store it with `releasekit-notes auth openai-compatible`.

---

## LLM Tasks

Tasks are configured under `llm.tasks`. Multiple tasks can be enabled simultaneously.

### `enhance`

Rewrites each changelog entry description to be clearer and more user-facing.

**Input:** `"fix: npe in auth middleware when token is null"`
**Output:** `"Fixed a crash that could occur during authentication when no token was present"`

```json
{ "tasks": { "enhance": true } }
```

Entry descriptions are processed in parallel (default concurrency: `5`). Adjust with `concurrency`:

```json
{ "concurrency": 3 }
```

When `enhance` and `categorize` are both enabled, the pipeline runs a single combined `enhanceAndCategorize` call — see [Combined enhance + categorize](#combined-enhance--categorize). The combined call also generates `leadIn` phrases: short noun phrases (e.g. `"Streaming API"`, `"Deeplink testing"`) for notable entries that render as `**leadIn**: description` in the built-in output. Routine fixes and bumps receive no `leadIn`.

### `summarize`

Generates a one-paragraph summary of the entire release, added to the template context as `enhanced.summary`.

```json
{ "tasks": { "summarize": true } }
```

### `categorize`

Groups entries into user-friendly categories rather than conventional commit types. The result is available in templates as `enhanced.categories`.

```json
{ "tasks": { "categorize": true } }
```

**Default categories** (used when `categories` is not configured):

| Name | Description |
|------|-------------|
| `Breaking` | Breaking changes that require user action to upgrade |
| `New` | New features and capabilities |
| `Changed` | Changes to existing functionality |
| `Fixed` | Bug fixes |
| `Developer` | Internal changes: CI, tooling, dependencies, refactoring |

Provide a custom list to override the defaults:

```json
{
  "tasks": { "categorize": true },
  "categories": [
    { "name": "New Features", "description": "New user-facing functionality" },
    { "name": "Bug Fixes", "description": "Corrections to existing behaviour" },
    { "name": "Under the Hood", "description": "Internal changes users may not notice" }
  ]
}
```

Control the render order of categories with `categoryOrder`. The `Breaking` category is always pinned first even if omitted:

```json
{ "categoryOrder": ["Breaking", "New", "Fixed", "Changed", "Developer"] }
```

### `releaseNotes`

Generates complete prose release notes for the version — suitable for a GitHub release body. Available in the pipeline result as `releaseNotes` and used automatically when `publish.githubRelease.body` is set to `"releaseNotes"`.

```json
{ "tasks": { "releaseNotes": true } }
```

You do not need `mode` or `file` configured for this task — the generated text is passed through the pipeline even without file output.

---

## Combined enhance + categorize

When both `enhance: true` and `categorize: true` are set, the pipeline makes a **single LLM call** (`enhanceAndCategorize`) that rewrites descriptions, assigns categories, generates `leadIn` phrases, identifies scopes, and flags breaking changes — all in one pass. This is more efficient than two sequential calls and is the recommended configuration when using both tasks.

```json
{ "tasks": { "enhance": true, "categorize": true } }
```

To customise the prompt for the combined call, use the `enhanceAndCategorize` key in `prompts.instructions`. The standalone `enhance` key applies only when `categorize` is disabled:

```json
{
  "llm": {
    "prompts": {
      "instructions": {
        "enhanceAndCategorize": "Prefer 'New' over 'Changed' for additive changes.",
        "enhance": "Applied only when categorize is not enabled."
      }
    }
  }
}
```

---

## Prompt Customisation

Override the built-in prompt instructions for any task. The string is appended to the relevant system prompt. Keys are task names.

### Custom instructions

Append extra instructions to the built-in prompt:

```json
{
  "llm": {
    "prompts": {
      "instructions": {
        "enhance": "Write in a friendly tone for non-technical users. Keep entries under 15 words.",
        "releaseNotes": "Start with a one-sentence headline, then group changes by theme."
      }
    }
  }
}
```

### Full prompt template override

Replace the entire prompt for a task. The string is sent to the LLM verbatim — no placeholder substitution is applied.

```json
{
  "llm": {
    "prompts": {
      "templates": {
        "enhance": "You are a technical writer. Rewrite the changelog entry below as a single, concise sentence in plain English. Return only the rewritten text, nothing else."
      }
    }
  }
}
```

---

## CLI Flags

LLM options can also be set via CLI flags without a config file:

```bash
releasekit-notes \
  --llm-provider anthropic \
  --llm-model claude-haiku-4-5 \
  --llm-tasks enhance,release-notes \
  --input version-output.json
```

Use `--no-llm` to disable LLM processing even when it is configured:

```bash
releasekit-notes --no-llm
```

Use `--no-release-notes` to disable release notes entirely (including LLM):

```bash
releasekit-notes --no-release-notes
```
