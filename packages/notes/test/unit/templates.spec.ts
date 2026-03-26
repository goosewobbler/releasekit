import * as fs from 'node:fs';
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

describe('Liquid Engine', () => {
  it('should render basic template', () => {
    const template = 'Version: {{ version }}';
    const result = renderLiquid(template, sampleContext);
    expect(result).toBe('Version: 1.0.0');
  });

  it('should render entries loop', () => {
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
  it('should render basic template', () => {
    const template = 'Version: {{version}}';
    const result = renderHandlebars(template, sampleContext);
    expect(result).toBe('Version: 1.0.0');
  });

  it('should render entries loop', () => {
    const template = '{{#each entries}}- {{description}}{{/each}}';
    const result = renderHandlebars(template, sampleContext);
    expect(result).toBe('- New feature- Bug fix');
  });

  it('should uppercase the first letter of a string with the capitalize helper', () => {
    registerHandlebarsHelpers();
    const template = '{{capitalize type}}';
    const entry = sampleContext.entries[0];
    if (!entry) throw new Error('No entry found');
    const result = renderHandlebars(template, { ...sampleContext, ...entry } as unknown as TemplateContext);
    expect(result).toBe('Added');
  });
});

describe('EJS Engine', () => {
  it('should render basic template', () => {
    const template = 'Version: <%= version %>';
    const result = renderEjs(template, sampleContext);
    expect(result).toBe('Version: 1.0.0');
  });

  it('should render entries loop', () => {
    const template = '<% entries.forEach(function(e) { %>- <%= e.description %><% }); %>';
    const result = renderEjs(template, sampleContext);
    expect(result).toBe('- New feature- Bug fix');
  });
});

describe('release.liquid template', () => {
  const template = fs.readFileSync(
    path.resolve(__dirname, '../../../../templates/release-notes/release.liquid'),
    'utf-8',
  );

  it('should render categories from enhanced.categories', () => {
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

  it('should fall back to type-based sections when no enhanced.categories', () => {
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

  it('should render compareUrl when present', () => {
    const ctx: DocumentContext = {
      project: { name: 'test-pkg' },
      versions: [{ ...sampleContext, compareUrl: 'https://github.com/test/test-pkg/compare/v0.9.0...v1.0.0' }],
    };

    const result = renderLiquid(template, ctx);
    expect(result).toContain('**Full Changelog**: https://github.com/test/test-pkg/compare/v0.9.0...v1.0.0');
  });

  it('should skip empty categories', () => {
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

  it('should render version header with package name and version', () => {
    const ctx: DocumentContext = {
      project: { name: 'test-pkg' },
      versions: [{ ...sampleContext, packageName: '@releasekit/publish', version: '0.4.0' }],
    };

    const result = renderLiquid(template, ctx);
    expect(result).toContain('## `@releasekit/publish` @ 0.4.0');
  });

  it('should render separator between multiple versions', () => {
    const ctx: DocumentContext = {
      project: { name: 'test-pkg' },
      versions: [
        {
          ...sampleContext,
          packageName: 'pkg-a',
          version: '1.0.0',
          entries: [{ type: 'added', description: 'Feature A' }],
        },
        {
          ...sampleContext,
          packageName: 'pkg-b',
          version: '2.0.0',
          entries: [{ type: 'added', description: 'Feature B' }],
        },
      ],
    };

    const result = renderLiquid(template, ctx);
    expect(result).toContain('## `pkg-a` @ 1.0.0');
    expect(result).toContain('## `pkg-b` @ 2.0.0');
    expect(result).toContain('---');
  });

  it('should not render separator after last version', () => {
    const ctx: DocumentContext = {
      project: { name: 'test-pkg' },
      versions: [
        {
          ...sampleContext,
          packageName: 'pkg-a',
          version: '1.0.0',
          entries: [{ type: 'added', description: 'Feature A' }],
        },
        {
          ...sampleContext,
          packageName: 'pkg-b',
          version: '2.0.0',
          entries: [{ type: 'added', description: 'Feature B' }],
        },
      ],
    };

    const result = renderLiquid(template, ctx);
    const lastVersionIndex = result.lastIndexOf('## `pkg-b`');
    const afterLastVersion = result.substring(lastVersionIndex);
    expect(afterLastVersion).not.toMatch(/^## `pkg-b`[\s]*---/s);
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
