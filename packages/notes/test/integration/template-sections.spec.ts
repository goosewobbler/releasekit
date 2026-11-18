import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runPipeline } from '../../src/core/pipeline.js';
import type { ChangelogInput } from '../../src/core/types.js';
import { createProvider } from '../../src/llm/index.js';

vi.mock('../../src/llm/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/llm/index.js')>();
  return { ...actual, createProvider: vi.fn() };
});

const input: ChangelogInput = {
  source: 'version',
  packages: [
    {
      packageName: '@acme/app',
      version: '2.0.0',
      previousVersion: 'v1.5.0',
      revisionRange: 'v1.5.0..HEAD',
      repoUrl: null,
      date: '2026-01-15',
      entries: [
        { type: 'added', description: 'Add deep link support' },
        { type: 'changed', description: 'Rename connect() to initialize()', breaking: true },
        { type: 'fixed', description: 'Fix leak for @acme/app', scope: 'ipc', issueIds: ['#12'] },
      ],
    },
  ],
};

const categorized = JSON.stringify({
  entries: [
    { description: 'Add deep link support', category: 'New', scope: null, breaking: null, leadIn: 'Deeplinks' },
    { description: 'Rename connect()', category: 'New', scope: null, breaking: true, leadIn: null },
    { description: 'Fix leak for @acme/app', category: 'Fixed', scope: 'ipc', breaking: null, leadIn: null },
  ],
});

const TEMPLATE = `{%- for version in versions %}{% for section in version.sections %}[{{ section.label }}]
{% for entry in section.entries %}{{ entry.line }}
{% endfor %}{% endfor %}{% if version.enhanced.categories %}categories leaked{% endif %}{% endfor %}`;

const llm = {
  provider: 'mock',
  model: 'mock',
  tasks: { enhance: true, categorize: true },
  examples: 0,
};

describe('Template sections', () => {
  let dir: string;
  let templatePath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'releasekit-template-sections-'));
    templatePath = path.join(dir, 'sections.liquid');
    fs.writeFileSync(templatePath, TEMPLATE);
    vi.mocked(createProvider).mockReturnValue({
      name: 'mock',
      capabilities: { systemRole: true, structuredOutputs: false, toolUse: false },
      complete: async () => ({ content: categorized, structured: JSON.parse(categorized) }),
    });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('should give a release-notes template the LLM categories, Breaking first', async () => {
    const result = await runPipeline(
      input,
      { changelog: false, releaseNotes: { templates: { path: templatePath, engine: 'liquid' }, llm } },
      false,
    );

    expect(result.releaseNotes?.['@acme/app']).toBe(
      '[Breaking]\n- Rename connect()\n[New]\n- **Deeplinks**: Add deep link support\n[Fixed]\n- **ipc**: Fix leak for \\@acme/app (\\#12)\n',
    );
  });

  it("should give a changelog template commit-type sections with the built-in renderer's lines", async () => {
    const file = path.join(dir, 'CHANGELOG.md');
    const result = await runPipeline(
      input,
      { changelog: { mode: 'root', file, templates: { path: templatePath, engine: 'liquid' } }, releaseNotes: { llm } },
      false,
    );

    const rendered = fs.readFileSync(file, 'utf-8');
    expect(rendered).toBe(
      '[Breaking]\n- Rename connect() to initialize()\n[Added]\n- Add deep link support\n[Fixed]\n- **ipc**: Fix leak for \\@acme/app (\\#12)\n',
    );
    for (const line of rendered.split('\n').filter((l) => l.startsWith('- '))) {
      expect(result.packageNotes['@acme/app']).toContain(line);
    }
  });
});
