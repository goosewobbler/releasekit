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
