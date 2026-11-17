import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ChangelogInput, type Config, type LLMConfig, runPipeline } from '../../src/index.js';
import type { CompleteResult, LLMMessage } from '../../src/llm/messages.js';
import type { LLMProvider } from '../../src/llm/provider.js';

vi.mock('../../src/llm/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/llm/index.js')>();
  return { ...actual, createProvider: vi.fn() };
});

const BUILTIN_TEMPLATES = path.resolve(__dirname, '../../templates');
const REPO_URL = 'https://github.com/acme/my-lib';

const ENHANCED: Record<string, string> = {
  'add streaming': 'Responses can now be streamed',
  'fix null pointer': 'Fixed a crash when the config is empty',
};

const input: ChangelogInput = {
  source: 'version',
  packages: [
    {
      packageName: 'my-lib',
      version: '2.0.0',
      previousVersion: 'v1.0.0',
      revisionRange: 'v1.0.0..HEAD',
      repoUrl: REPO_URL,
      date: '2026-01-15',
      entries: [
        { type: 'added', description: 'add streaming' },
        { type: 'fixed', description: 'fix null pointer' },
      ],
    },
  ],
};

function stubProvider(prose = 'LLM prose'): LLMProvider {
  return {
    name: 'stub',
    capabilities: { systemRole: true, structuredOutputs: false, toolUse: false },
    async complete(messages: LLMMessage[]): Promise<CompleteResult> {
      const system = messages[0]?.content ?? '';
      const user = messages.at(-1)?.content ?? '';
      if (system.startsWith('You are improving changelog entries')) {
        const raw = Object.keys(ENHANCED).find((d) => user.includes(d));
        return { content: raw ? (ENHANCED[raw] as string) : user };
      }
      if (system.startsWith('You are categorizing')) {
        const content = JSON.stringify({
          entries: [
            { category: 'Highlights', scope: null },
            { category: 'Fixes', scope: null },
          ],
        });
        return { content, structured: JSON.parse(content) };
      }
      if (system.startsWith('You are writing release notes')) {
        return { content: prose };
      }
      throw new Error(`unexpected prompt: ${system.slice(0, 40)}`);
    },
  };
}

function llm(tasks: LLMConfig['tasks'], extra: Partial<LLMConfig> = {}): LLMConfig {
  return { provider: 'openai', model: 'stub', examples: 0, context: { pullRequests: false }, tasks, ...extra };
}

describe('Pipeline: rendered notes', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'releasekit-rendered-notes-'));
    const { createProvider } = await import('../../src/llm/index.js');
    vi.mocked(createProvider).mockReturnValue(stubProvider());
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function render(config: Config) {
    const result = await runPipeline(input, config, false);
    const read = (suffix: string) => {
      const file = result.files.find((f) => f.endsWith(suffix));
      return file ? fs.readFileSync(file, 'utf-8') : undefined;
    };
    return {
      changelog: read('CHANGELOG.md'),
      perVersionFile: read('2.0.0.md'),
      body: result.releaseNotes?.['my-lib'],
    };
  }

  describe('enhance without categorize', () => {
    it('should render the enhanced descriptions in the per-version file and release body but not the changelog', async () => {
      const out = await render({
        changelog: { mode: 'root', file: path.join(tmpDir, 'CHANGELOG.md') },
        releaseNotes: { file: { dir: path.join(tmpDir, 'notes') }, llm: llm({ enhance: true }) },
      });

      for (const rendered of [out.perVersionFile, out.body]) {
        expect(rendered).toContain('Responses can now be streamed');
        expect(rendered).toContain('Fixed a crash when the config is empty');
        expect(rendered).not.toContain('add streaming');
      }
      expect(out.changelog).toContain('add streaming');
      expect(out.changelog).not.toContain('Responses can now be streamed');
    });

    it.each([
      ['keep-a-changelog', path.join(BUILTIN_TEMPLATES, 'keep-a-changelog')],
      ['angular', path.join(BUILTIN_TEMPLATES, 'angular')],
      ['github-release', path.join(BUILTIN_TEMPLATES, 'github-release', 'release.md.ejs')],
    ])(
      'should render the enhanced descriptions through the built-in %s release-notes template',
      async (_name, templatePath) => {
        const out = await render({
          changelog: { mode: 'root', file: path.join(tmpDir, 'CHANGELOG.md'), templates: { path: templatePath } },
          releaseNotes: {
            file: { dir: path.join(tmpDir, 'notes') },
            templates: { path: templatePath },
            llm: llm({ enhance: true }),
          },
        });

        for (const rendered of [out.perVersionFile, out.body]) {
          expect(rendered).toContain('Responses can now be streamed');
          expect(rendered).not.toContain('add streaming');
        }
        expect(out.changelog).toContain('add streaming');
      },
    );
  });

  describe('release body matches the per-version file', () => {
    it('should apply links and categoryOrder to both', async () => {
      const out = await render({
        changelog: false,
        releaseNotes: {
          file: { dir: path.join(tmpDir, 'notes') },
          links: { items: [{ label: 'Docs', url: 'https://docs.example.com' }] },
          llm: llm({ categorize: true }, { categoryOrder: ['Fixes', 'Highlights'] }),
        },
      });

      expect(out.body).toBe(out.perVersionFile);
      expect(out.body).toContain('- [Docs](https://docs.example.com)');
      const fixes = out.body?.indexOf('### Fixes') ?? -1;
      expect(fixes).toBeGreaterThanOrEqual(0);
      expect(fixes).toBeLessThan(out.body?.indexOf('### Highlights') ?? -1);
    });

    it('should render the configured template for both', async () => {
      const templatePath = path.join(tmpDir, 'release.liquid');
      fs.writeFileSync(templatePath, 'Notes for {{ versions[0].version }}');

      const out = await render({
        changelog: false,
        releaseNotes: { file: { dir: path.join(tmpDir, 'notes') }, templates: { path: templatePath } },
      });

      expect(out.body).toBe('Notes for 2.0.0');
      expect(out.perVersionFile).toBe(out.body);
    });

    it('should use the LLM prose for both when no template is configured', async () => {
      const out = await render({
        changelog: false,
        releaseNotes: { file: { dir: path.join(tmpDir, 'notes') }, llm: llm({ releaseNotes: true }) },
      });

      expect(out.body).toBe('LLM prose');
      expect(out.perVersionFile).toBe(out.body);
    });

    it('should fall back to the formatted changelog for both when the LLM prose is blank', async () => {
      const { createProvider } = await import('../../src/llm/index.js');
      vi.mocked(createProvider).mockReturnValue(stubProvider('  \n'));

      const out = await render({
        changelog: false,
        releaseNotes: { file: { dir: path.join(tmpDir, 'notes') }, llm: llm({ releaseNotes: true }) },
      });

      expect(out.body).toContain('add streaming');
      expect(out.perVersionFile).toBe(out.body);
    });

    it('should let a configured template win over the LLM prose for both', async () => {
      const templatePath = path.join(tmpDir, 'release.liquid');
      fs.writeFileSync(templatePath, 'Template: {{ versions[0].enhanced.releaseNotes }}');

      const out = await render({
        changelog: false,
        releaseNotes: {
          file: { dir: path.join(tmpDir, 'notes') },
          templates: { path: templatePath },
          llm: llm({ releaseNotes: true }),
        },
      });

      expect(out.body).toBe('Template: LLM prose');
      expect(out.perVersionFile).toBe(out.body);
    });
  });

  it('should set project.repoUrl in user templates for the changelog, per-version file and release body', async () => {
    const templatePath = path.join(tmpDir, 'repo.liquid');
    fs.writeFileSync(templatePath, 'repo={{ project.repoUrl }}');

    const out = await render({
      changelog: { mode: 'root', file: path.join(tmpDir, 'CHANGELOG.md'), templates: { path: templatePath } },
      releaseNotes: { file: { dir: path.join(tmpDir, 'notes') }, templates: { path: templatePath } },
    });

    expect(out.changelog).toBe(`repo=${REPO_URL}`);
    expect(out.perVersionFile).toBe(`repo=${REPO_URL}`);
    expect(out.body).toBe(`repo=${REPO_URL}`);
  });
});
