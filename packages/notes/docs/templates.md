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
├── version.liquid     # One version block (a Version, as `version` in Liquid)
└── entry.liquid       # One changelog entry (receives an Entry)
```

```bash
releasekit-notes --template ./templates/
```

All three files are optional — omit any you don't need to customise, and the built-in for that level is used.

An entry template gets one [Entry](#entry). Handlebars and EJS entry templates get its fields directly, as in `{{{line}}}`. A Liquid include shares the caller's variables, so name the `version.liquid` loop variable `entry` and use `{{ entry.line }}`.

### Writing to an existing changelog

A changelog template renders only this run's versions, in `versions`. How the output reaches the file:

- **New or empty file:** the whole output is written.
- **Existing file:** the output from its first line starting with `## ` goes directly under the file's header, which is everything before the file's first `## ` line. The rest of the file is kept. Anything the template renders before its first `## ` line, such as its own header, is dropped. Everything from that line to the end of the output is inserted on every run, so render only version sections after the header: no footer, such as link reference definitions, and no fixed `## ` section, such as `## [Unreleased]`.

So start each version section with a level-2 heading (`## `). If the output has none, an existing file is left unchanged and a warning is logged.

In `packages` and `both` modes, each package's changelog is rendered on its own: `versions` holds only that package's version, and `project.name` is the package name.

---

## Template Context

### Document context

The outermost template (`document`) receives:

| Variable | Type | Description |
|----------|------|-------------|
| `project.name` | `string` | Repository/package name |
| `project.repoUrl` | `string \| null` | Repository URL |
| `versions` | `Version[]` | All rendered versions, newest first |
| `unreleased` | `Version \| undefined` | Unreleased changes, if any |
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
| `entries` | `Entry[]` | Changelog entries in commit order. Release-notes templates get the LLM-rewritten entries when `tasks.enhance` is on; changelog templates always get the commit-derived ones |
| `sections` | `Section[]` | The same entries grouped as the built-in renderer groups them (see below) |
| `shared` | `Section[]` | [Shared-package entries](monorepo.md#project-wide-changes) in commit-type groups, which the built-in renderer lists under `### Project-wide changes` after the version's own. Empty in a root changelog |
| `enhanced` | `object \| undefined` | LLM-written text (see below) |

### Sections

Each section in `sections` has a `label` and its `entries`, in this order:

1. `Breaking`, holding every breaking entry. With LLM categories, `categoryOrder` can place it later.
2. With the `categorize` task on a release-notes template, the LLM categories, ordered by `categoryOrder`. Otherwise the commit types, labelled `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed` and `Security`, in that order.
3. Without LLM categories, `Dependencies & version bumps`, holding non-breaking `deps` and `deps-dev` entries.

Empty sections are left out. To use your own heading, match the label:

```liquid
{% for section in version.sections %}
### {% if section.label == "Added" %}New{% else %}{{ section.label }}{% endif %}
{% for entry in section.entries %}
{{ entry.line }}
{% endfor %}
{% endfor %}
```

A breaking entry is marked by its section, not its line. A template that lists the flat `entries` has to check `entry.breaking` itself.

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
| `line` | `string` | The built-in renderer's Markdown line: `- **scope**: description (refs)`, with the lead-in in the scope's place and refs rendered per `notes.changelog.refs` |

`line` has `@` mentions and `<!--` comment openers escaped; the other fields are raw commit or LLM text. Print it without the engine's HTML escaping: `{{{ line }}}` in Handlebars, `<%- line %>` in EJS. Liquid doesn't escape.

### Enhanced data (`enhanced`)

Present in release-notes templates when the `summarize` or `releaseNotes` task produced text. Changelog templates never get it:

| Field | Type | Description |
|-------|------|-------------|
| `enhanced.summary` | `string \| undefined` | 2–3 sentence release summary (`summarize` task) |
| `enhanced.releaseNotes` | `string \| undefined` | Full prose release notes (`releaseNotes` task) |

The `categorize` task's categories come through `sections`.

### Built-in renderer behaviour

When no custom template is configured, the built-in markdown renderer applies the following transformations to LLM-categorised output. Templates get the same grouping in `sections`.

**Breaking change re-routing:** Any entry with `breaking: true` is moved to a `Breaking` category at render time, regardless of which category the LLM assigned it to. See [Sections](#sections) for the order.

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
## [{{ version.version }}]({{ version.compareUrl }}) — {{ version.date }}
{% for section in version.sections %}
### {{ section.label }}
{% for entry in section.entries %}
{{ entry.line }}
{% endfor %}
{% endfor %}
```

### Handlebars (`version.hbs`)

```handlebars
## [{{version}}] — {{date}}

{{#if enhanced.summary}}
> {{{enhanced.summary}}}

{{/if}}
{{#each sections}}
### {{{label}}}

{{#each entries}}
{{{line}}}
{{/each}}

{{/each}}
```

### EJS (composable — `version.ejs`)

```ejs
## <%= version %> — <%= date %>

<% if (enhanced && enhanced.releaseNotes) { %>
<%- enhanced.releaseNotes %>
<% } else { %>
<% sections.forEach(section => { %>
### <%- section.label %>

<% section.entries.forEach(entry => { %>
<%- entry.line %>
<% }) %>
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
