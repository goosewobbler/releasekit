import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Config, processInput } from '../../src/index.js';
import type { CompleteResult, LLMMessage } from '../../src/llm/messages.js';

vi.mock('../../src/llm/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/llm/index.js')>();
  return { ...actual, createProvider: vi.fn() };
});

const versionOutput = JSON.stringify({
  dryRun: false,
  updates: [],
  tags: [],
  changelogs: [
    {
      packageName: 'app',
      version: '2.0.0',
      previousVersion: 'app/v1.0.0',
      revisionRange: 'app/v1.0.0..HEAD',
      repoUrl: null,
      entries: [{ type: 'feat', description: 'add streaming' }],
      bundled: [
        { packageName: 'lib', versions: ['1.0.1', '1.0.2'] },
        { packageName: 'plugin', versions: ['1.1.0'] },
      ],
    },
    {
      packageName: 'plugin',
      version: '1.1.0',
      previousVersion: 'plugin/v1.0.0',
      revisionRange: 'plugin/v1.0.0..HEAD',
      repoUrl: null,
      entries: [{ type: 'fix', description: 'fix plugin' }],
    },
  ],
  bundledReleases: [
    { packageName: 'lib', version: '1.0.1', entries: [{ type: 'fix', description: 'fix lib once' }] },
    { packageName: 'lib', version: '1.0.2', entries: [{ type: 'feat', description: 'add lib option' }] },
  ],
});

const BUNDLED =
  '### lib 1.0.1 → 1.0.2\n\n#### Added\n\n- add lib option\n\n#### Fixed\n\n- fix lib once\n\n' +
  '### plugin 1.1.0\n\n#### Fixed\n\n- fix plugin\n';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-notes-bundled-'));
  const { createProvider } = await import('../../src/llm/index.js');
  vi.mocked(createProvider).mockReturnValue({
    name: 'stub',
    capabilities: { systemRole: true, structuredOutputs: false, toolUse: false },
    async complete(messages: LLMMessage[]): Promise<CompleteResult> {
      if (messages[0]?.content.startsWith('You are writing release notes')) {
        return { content: 'LLM prose' };
      }
      throw new Error('unexpected prompt');
    },
  });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function render(config: Config) {
  const result = await processInput(versionOutput, config, false);
  const read = (suffix: string) => {
    const file = result.files.find((f) => f.endsWith(suffix));
    return file ? fs.readFileSync(file, 'utf-8') : undefined;
  };
  return { changelog: read('CHANGELOG.md'), notesFile: read('2.0.0.md'), body: result.releaseNotes?.app };
}

describe('Bundled release notes', () => {
  it("should follow the primary's own notes in the release body and notes file, but not the changelog", async () => {
    const out = await render({
      changelog: { mode: 'root', file: path.join(tmpDir, 'CHANGELOG.md') },
      releaseNotes: { file: { dir: path.join(tmpDir, 'notes') } },
    });

    expect(out.body).toMatch(
      new RegExp(`### Added\\n\\n- add streaming\\n\\n${BUNDLED.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
    );
    expect(out.notesFile).toBe(out.body);
    expect(out.changelog).not.toContain('fix lib once');
  });

  it('should leave out the placeholder of a primary bumped only for its bundled packages', async () => {
    const output = JSON.parse(versionOutput);
    output.changelogs[0].entries = [{ type: 'changed', description: 'Update version to 2.0.0' }];

    const result = await processInput(JSON.stringify(output), { changelog: false, releaseNotes: {} }, false);

    expect(result.releaseNotes?.app).not.toContain('Update version to 2.0.0');
    expect(result.releaseNotes?.app).toContain(BUNDLED);
  });

  it('should follow the LLM prose', async () => {
    const out = await render({
      changelog: false,
      releaseNotes: {
        llm: {
          provider: 'openai',
          model: 'stub',
          examples: 0,
          context: { pullRequests: false },
          tasks: { releaseNotes: true },
        },
      },
    });

    expect(out.body).toBe(`LLM prose\n\n${BUNDLED}`);
  });

  it('should give a template the bundled packages', async () => {
    const templatePath = path.join(tmpDir, 'release.liquid');
    fs.writeFileSync(
      templatePath,
      '{% for b in versions[0].bundled %}{{ b.packageName }} {{ b.firstVersion }}..{{ b.version }}: ' +
        '{% for s in b.sections %}{{ s.label }}={% for e in s.entries %}{{ e.line }}{% endfor %};{% endfor %}\n{% endfor %}',
    );

    const out = await render({ changelog: false, releaseNotes: { templates: { path: templatePath } } });

    expect(out.body).toBe(
      'lib 1.0.1..1.0.2: Added=- add lib option;Fixed=- fix lib once;\nplugin ..1.1.0: Fixed=- fix plugin;\n',
    );
  });
});
