import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DocumentContext, TemplateContext } from '../../src/core/types.js';
import { renderEjs } from '../../src/templates/ejs.js';
import { registerHandlebarsHelpers, renderHandlebars } from '../../src/templates/handlebars.js';
import { renderLiquid } from '../../src/templates/liquid.js';
import { detectTemplateMode } from '../../src/templates/loader.js';

const sampleContext: TemplateContext = {
  packageName: 'test-pkg',
  version: '1.0.0',
  previousVersion: null,
  date: '2026-02-21',
  repoUrl: 'https://github.com/test/test-pkg',
  entries: [
    { type: 'added', description: 'New feature' },
    { type: 'fixed', description: 'Bug fix', scope: 'core' },
  ],
};

const _documentContext: DocumentContext = {
  project: { name: 'test-pkg' },
  versions: [sampleContext],
};

describe('Liquid Engine', () => {
  it('renders basic template', () => {
    const template = 'Version: {{ version }}';
    const result = renderLiquid(template, sampleContext);
    expect(result).toBe('Version: 1.0.0');
  });

  it('renders entries loop', () => {
    const template = '{% for entry in entries %}- {{ entry.description }}{% endfor %}';
    const result = renderLiquid(template, sampleContext);
    expect(result).toBe('- New feature- Bug fix');
  });

  it('should handle conditionals', () => {
    const template = '{% if previousVersion %}Has previous{% else %}No previous{% endif %}';
    const result = renderLiquid(template, sampleContext);
    expect(result).toBe('No previous');
  });
});

describe('Handlebars Engine', () => {
  it('renders basic template', () => {
    const template = 'Version: {{version}}';
    const result = renderHandlebars(template, sampleContext);
    expect(result).toBe('Version: 1.0.0');
  });

  it('renders entries loop', () => {
    const template = '{{#each entries}}- {{description}}{{/each}}';
    const result = renderHandlebars(template, sampleContext);
    expect(result).toBe('- New feature- Bug fix');
  });

  it('capitalize helper works', () => {
    registerHandlebarsHelpers();
    const template = '{{capitalize type}}';
    const entry = sampleContext.entries[0];
    if (!entry) throw new Error('No entry found');
    const result = renderHandlebars(template, { ...sampleContext, ...entry } as unknown as TemplateContext);
    expect(result).toBe('Added');
  });
});

describe('EJS Engine', () => {
  it('renders basic template', () => {
    const template = 'Version: <%= version %>';
    const result = renderEjs(template, sampleContext);
    expect(result).toBe('Version: 1.0.0');
  });

  it('renders entries loop', () => {
    const template = '<% entries.forEach(function(e) { %>- <%= e.description %><% }); %>';
    const result = renderEjs(template, sampleContext);
    expect(result).toBe('- New feature- Bug fix');
  });
});

// Inline the relevant release-notes template content to keep this test self-contained.
// Mirrors templates/release-notes/release.liquid.
const releaseNotesTemplate = `
{%- for version in versions %}
{%- if version.enhanced.categories %}
{%- for cat in version.enhanced.categories %}
{%- if cat.entries.size > 0 %}

### {{ cat.name }}:
{%- for entry in cat.entries %}
{%- if entry.scope %}
- **{{ entry.scope }}**: {{ entry.description }}
{%- else %}
- {{ entry.description }}
{%- endif %}
{%- endfor %}
{%- endif %}
{%- endfor %}
{%- else %}
{%- assign added = version.entries | where: "type", "added" %}
{%- assign fixed = version.entries | where: "type", "fixed" %}
{%- if added.size > 0 %}

### New:
{%- for entry in added %}
- {% if entry.scope %}**{{ entry.scope }}**: {% endif %}{{ entry.description }}
{%- endfor %}
{%- endif %}
{%- if fixed.size > 0 %}

### Fixed:
{%- for entry in fixed %}
- {% if entry.scope %}**{{ entry.scope }}**: {% endif %}{{ entry.description }}
{%- endfor %}
{%- endif %}
{%- endif %}
{%- if version.compareUrl %}

**Full Changelog**: {{ version.compareUrl }}
{%- endif %}
{% endfor %}
`.trim();

describe('release.liquid template', () => {
  const template = releaseNotesTemplate;

  it('renders categories from enhanced.categories', () => {
    const ctx: DocumentContext = {
      project: { name: 'test-pkg' },
      versions: [
        {
          ...sampleContext,
          enhanced: {
            entries: sampleContext.entries,
            categories: [
              { name: 'New', entries: [{ type: 'added', description: 'New feature' }] },
              { name: 'Fixed', entries: [{ type: 'fixed', description: 'Bug fix', scope: 'core' }] },
            ],
          },
        },
      ],
    };

    const result = renderLiquid(template, ctx);
    expect(result).toContain('### New:');
    expect(result).toContain('- New feature');
    expect(result).toContain('### Fixed:');
    expect(result).toContain('- **core**: Bug fix');
  });

  it('falls back to type-based sections when no enhanced.categories', () => {
    const ctx: DocumentContext = {
      project: { name: 'test-pkg' },
      versions: [sampleContext],
    };

    const result = renderLiquid(template, ctx);
    expect(result).toContain('### New:');
    expect(result).toContain('- New feature');
    expect(result).toContain('### Fixed:');
    expect(result).toContain('- **core**: Bug fix');
  });

  it('renders compareUrl when present', () => {
    const ctx: DocumentContext = {
      project: { name: 'test-pkg' },
      versions: [{ ...sampleContext, compareUrl: 'https://github.com/test/test-pkg/compare/v0.9.0...v1.0.0' }],
    };

    const result = renderLiquid(template, ctx);
    expect(result).toContain('**Full Changelog**: https://github.com/test/test-pkg/compare/v0.9.0...v1.0.0');
  });

  it('skips empty categories', () => {
    const ctx: DocumentContext = {
      project: { name: 'test-pkg' },
      versions: [
        {
          ...sampleContext,
          enhanced: {
            entries: sampleContext.entries,
            categories: [
              { name: 'New', entries: [] },
              { name: 'Fixed', entries: [{ type: 'fixed', description: 'Bug fix' }] },
            ],
          },
        },
      ],
    };

    const result = renderLiquid(template, ctx);
    expect(result).not.toContain('### New:');
    expect(result).toContain('### Fixed:');
  });
});

describe('Template Loader', () => {
  it('should detect single file mode', () => {
    const templatePath = path.join(process.cwd(), 'templates', 'keep-a-changelog', 'document.liquid');
    const mode = detectTemplateMode(templatePath);
    expect(mode).toBe('single');
  });

  it('should detect composable mode for directory', () => {
    const templatePath = path.join(process.cwd(), 'templates', 'keep-a-changelog');
    const mode = detectTemplateMode(templatePath);
    expect(mode).toBe('composable');
  });
});
