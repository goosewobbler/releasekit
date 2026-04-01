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

The file receives the full [Document context](#document-context) and must render the complete changelog document.

### Composable directory layout

Pass a directory containing named template files. Each file renders a different level of the document:

```
templates/
├── document.liquid    # Outer document wrapper (receives DocumentContext)
├── version.liquid     # One version block (receives TemplateContext)
└── entry.liquid       # One changelog entry (receives ChangelogEntry)
```

```bash
releasekit-notes --template ./templates/
```

All three files are optional — omit any you don't need to customise, and the built-in for that level is used.

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
| `entries` | `ChangelogEntry[]` | Raw changelog entries |
| `enhanced` | `EnhancedData \| undefined` | LLM-processed data (see below) |

### Entry

Each entry in `entries` has:

| Field | Type | Values |
|-------|------|--------|
| `type` | `ChangelogType` | `"added"`, `"changed"`, `"deprecated"`, `"removed"`, `"fixed"`, `"security"` |
| `description` | `string` | Entry description (enhanced by LLM if `tasks.enhance` is on) |
| `scope` | `string \| undefined` | Conventional commit scope |
| `breaking` | `boolean \| undefined` | `true` for breaking changes |
| `issueIds` | `string[] \| undefined` | Referenced issue/PR numbers |

### Enhanced data (`enhanced`)

Present when any LLM task ran successfully:

| Field | Type | Description |
|-------|------|-------------|
| `enhanced.summary` | `string \| undefined` | One-paragraph release summary (`summarize` task) |
| `enhanced.categories` | `Category[] \| undefined` | Grouped entries (`categorize` task) |
| `enhanced.releaseNotes` | `string \| undefined` | Full prose release notes (`releaseNotes` task) |

Each `Category` in `enhanced.categories`:

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Category display name |
| `entries` | `ChangelogEntry[]` | Entries in this category |

---

## Examples

### Liquid (single file)

```liquid
# Changelog

{% for v in versions %}
## [{{ v.version }}] — {{ v.date }}

{% if v.enhanced.summary %}
{{ v.enhanced.summary }}

{% endif %}
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
- {{ entry.description }}
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
