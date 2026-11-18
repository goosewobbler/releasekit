# Templates

`@releasekit/notes` supports custom templates for both changelog and release notes output. Templates can be single files or composable directory layouts, and can use Liquid, Handlebars, or EJS.

## Built-in Templates

| Name | Engine | Default for |
|------|--------|-------------|
| `keep-a-changelog` | Liquid | Changelog (default) |
| `angular` | Handlebars | — |
| `github-release` | EJS | — |

The default `keep-a-changelog` template produces [Keep a Changelog](https://keepachangelog.com)-formatted output. Switch to a different built-in via the `engine` option or use `--template` / `--engine` on the CLI.

---

## Custom Templates

### Single-file template

Pass a path to any single template file:

```bash
releasekit-notes --template ./my-changelog.liquid
```

```json
{
  "notes": {
    "changelog": {
      "templates": { "path": "./my-changelog.liquid" }
    }
  }
}
```

The file receives the full [Document context](#document-context) and renders a changelog document, which is [merged into an existing file](#writing-to-an-existing-changelog).

### Composable directory layout

Pass a directory containing named template files. Each file renders a different level of the document:

```
templates/
├── document.liquid    # Outer document wrapper (receives DocumentContext)
├── version.liquid     # One version block (receives TemplateContext)
└── entry.liquid       # One changelog entry (receives ChangelogEntry fields directly)
```

```bash
releasekit-notes --template ./templates/
```

All three files are optional — omit any you don't need to customise, and the built-in for that level is used.

The `entry.liquid` template receives the `ChangelogEntry` fields directly as top-level variables: `type`, `description`, `scope`, `breaking`, `issueIds`, `leadIn`.

### Writing to an existing changelog

A changelog template renders only this run's versions, in `versions`. How the output reaches the file:

- **New or empty file:** the whole output is written.
- **Existing file:** the output from its first version heading goes directly under the file's header, which is everything before the file's first version heading. A version heading is a `# `, `## ` or `### ` heading containing a version outside any link target, such as `## [1.2.0]`, `# [1.2.0](…) (2026-01-01)` or `## [@scope/pkg@1.2.0-next.0]`. `# Changelog` and `## [Unreleased]` aren't, so new versions go below an `## [Unreleased]` section. The rest of the file is kept. Anything the template renders before its first version heading, such as its own header, is dropped. Everything from that heading to the end of the output is inserted on every run, so render only version sections after the header: no footer, such as link reference definitions, and no fixed section, such as `## [Unreleased]`.

So start each version section with a version heading. If the output has none, an existing file is left unchanged and a warning is logged.

In `packages` and `both` modes, each package's changelog is rendered on its own: `versions` holds only that package's version, and `project.name` is the package name.

---

## Template Context

### Document context

The outermost template (`document`) receives:

| Variable | Type | Description |
|----------|------|-------------|
| `project.name` | `string` | Repository/package name |
| `project.repoUrl` | `string \| null` | Repository URL |
| `versions` | `TemplateContext[]` | All rendered versions, newest first |
| `unreleased` | `TemplateContext \| undefined` | Unreleased changes, if any |
| `compareUrls` | `Record<string, string> \| undefined` | Map of version → compare URL for all versions |
| `perPackage` | `boolean \| undefined` | `true` when rendered inline for a single package (e.g. GitHub release body). Use this to suppress document-level headings that are redundant when the content is embedded in a release that already shows the package name and version. |
| `output` | `'file' \| 'release' \| undefined` | Which release-notes destination this render targets: `'file'` (an in-repo per-version file) or `'release'` (the GitHub release body). Branch on it to emit content that only suits one — most importantly, docs-site **YAML frontmatter**, which would render as literal text in a GitHub release. |

A release-notes template that adds frontmatter for the in-repo file but not the GitHub release body:

```liquid
{% if output == "file" %}---
title: {{ versions[0].version }}
date: {{ versions[0].date }}
---
{% endif %}{% for v in versions %}{% for entry in v.entries %}- {{ entry.description }}
{% endfor %}{% endfor %}
```

### Version context

Each version block (`version`) receives:

| Variable | Type | Description |
|----------|------|-------------|
| `packageName` | `string` | Package name (e.g. `@releasekit/notes`) |
| `version` | `string` | New version string (e.g. `1.2.0`) |
| `previousVersion` | `string \| null` | Previous version string |
| `date` | `string` | Release date in `YYYY-MM-DD` format |
| `repoUrl` | `string \| null` | Repository URL |
| `compareUrl` | `string \| undefined` | Link to diff between previous and current version |
| `entries` | `ChangelogEntry[]` | Changelog entries. Release-notes templates get the LLM-rewritten entries when `tasks.enhance` is on; changelog templates always get the commit-derived ones |
| `enhanced` | `EnhancedData \| undefined` | LLM-processed data (see below) |

### Entry

Each entry in `entries` has:

| Field | Type | Values |
|-------|------|--------|
| `type` | `ChangelogType` | `"added"`, `"changed"`, `"deprecated"`, `"removed"`, `"fixed"`, `"security"` |
| `description` | `string` | Entry description (rewritten by LLM if `tasks.enhance` is on) |
| `scope` | `string \| undefined` | Conventional commit scope (may be assigned or validated by LLM) |
| `breaking` | `boolean \| undefined` | `true` for breaking changes. Combined `enhanceAndCategorize` can also set it. |
| `issueIds` | `string[] \| undefined` | Referenced issue/PR numbers |
| `leadIn` | `string \| undefined` | Short scannable phrase for notable entries (e.g. `"Streaming API"`). Set by the LLM during `enhance` or combined `enhanceAndCategorize`. `undefined` for routine entries. |

### Enhanced data (`enhanced`)

Present in release-notes templates when any LLM task ran successfully. Changelog templates never get it:

| Field | Type | Description |
|-------|------|-------------|
| `enhanced.summary` | `string \| undefined` | 2–3 sentence release summary (`summarize` task) |
| `enhanced.categories` | `Category[] \| undefined` | Grouped entries (`categorize` task) |
| `enhanced.releaseNotes` | `string \| undefined` | Full prose release notes (`releaseNotes` task) |

Each `Category` in `enhanced.categories`:

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Category display name |
| `entries` | `ChangelogEntry[]` | Entries in this category (same type as `entries`; may have `leadIn`, `scope`, `breaking` populated by the LLM) |

Entries within `enhanced.categories` are the same `ChangelogEntry` objects as in `entries`, with all LLM-assigned fields populated. Custom templates can access `entry.leadIn`, `entry.scope`, and `entry.breaking` directly.

### Built-in renderer behaviour

When no custom template is configured, the built-in markdown renderer applies the following transformations to LLM-categorised output. Custom templates receive the raw data and must implement these behaviours themselves if desired.

**Breaking change re-routing:** Any entry with `breaking: true` is moved to a `Breaking` category at render time, regardless of which category the LLM assigned it to. The `Breaking` category comes first unless `categoryOrder` places it. Output without LLM categories gets the same leading `Breaking` section, and lists non-breaking `deps` and `deps-dev` entries last, under `Dependencies & version bumps`. The section marks a breaking entry, so its line has no `**BREAKING**` prefix.

**`leadIn` prefix:** Entries with a `leadIn` value render as `**leadIn**: description`, in place of the scope.

**Links section:** When `notes.releaseNotes.links` is configured, a links section is appended after all categories. This section is only rendered in the LLM-categorised path.

---

## Examples

### Liquid (single file)

```liquid
# Changelog

{% for v in versions %}
## [{{ v.version }}] — {{ v.date }}

{% for entry in v.entries %}
- **{{ entry.type }}**: {{ entry.description }}{% if entry.scope %} *({{ entry.scope }})*{% endif %}
{% endfor %}

{% endfor %}
```

### Liquid (composable — `version.liquid`)

```liquid
## [{{ version }}]({{ compareUrl }}) — {{ date }}

{% if enhanced.categories %}
{% for cat in enhanced.categories %}
### {{ cat.name }}

{% for entry in cat.entries %}
{% if entry.breaking and entry.leadIn %}
- **BREAKING** **{{ entry.leadIn }}**: {{ entry.description }}
{% elsif entry.breaking %}
- **BREAKING** {{ entry.description }}
{% elsif entry.leadIn %}
- **{{ entry.leadIn }}**: {{ entry.description }}
{% elsif entry.scope %}
- **{{ entry.scope }}**: {{ entry.description }}
{% else %}
- {{ entry.description }}
{% endif %}
{% endfor %}
{% endfor %}
{% else %}
{% for entry in entries %}
- {{ entry.description }}
{% endfor %}
{% endif %}
```

### Handlebars (`version.hbs`)

```handlebars
## [{{version}}] — {{date}}

{{#if enhanced.summary}}
> {{enhanced.summary}}

{{/if}}
{{#each entries}}
- **{{type}}**: {{description}}
{{/each}}
```

### EJS (`release.md.ejs`)

```ejs
## <%= version %> — <%= date %>

<% if (enhanced && enhanced.releaseNotes) { %>
<%= enhanced.releaseNotes %>
<% } else { %>
<% entries.forEach(entry => { %>
- **<%= entry.type %>**: <%= entry.description %>
<% }) %>
<% } %>
```

---

## Engine Selection

The engine is inferred from the file extension (`.liquid`, `.hbs`/`.handlebars`, `.ejs`) if not explicitly set. Override via config or CLI:

```json
{
  "notes": {
    "changelog": {
      "templates": { "path": "./templates/", "engine": "handlebars" }
    }
  }
}
```

```bash
releasekit-notes --template ./templates/ --engine handlebars
```
