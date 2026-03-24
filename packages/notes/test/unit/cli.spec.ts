import * as fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs');
vi.mock('../../src/core/config.js');
vi.mock('../../src/core/pipeline.js');
vi.mock('../../src/input/version-output.js');
vi.mock('@releasekit/core');

import { createNotesCommand } from '../../src/cli.js';
import { getDefaultConfig, loadConfig } from '../../src/core/config.js';
import { runPipeline } from '../../src/core/pipeline.js';
import type { ChangelogInput, Config } from '../../src/core/types.js';
import { parseVersionOutput } from '../../src/input/version-output.js';

const baseConfig: Config = {
  output: [{ format: 'markdown', file: 'CHANGELOG.md' }],
  updateStrategy: 'prepend',
};

const twoPackageInput: ChangelogInput = {
  source: 'version',
  packages: [
    {
      packageName: 'pkg-a',
      version: '1.0.0',
      previousVersion: null,
      revisionRange: 'HEAD',
      repoUrl: null,
      date: '2026-01-01',
      entries: [],
    },
    {
      packageName: 'pkg-b',
      version: '1.0.0',
      previousVersion: null,
      revisionRange: 'HEAD',
      repoUrl: null,
      date: '2026-01-01',
      entries: [],
    },
  ],
};

describe('createNotesCommand', () => {
  beforeEach(() => {
    vi.mocked(loadConfig).mockReturnValue({ ...baseConfig });
    vi.mocked(getDefaultConfig).mockReturnValue({ output: [{ format: 'markdown', file: 'CHANGELOG.md' }] });
    vi.mocked(runPipeline).mockResolvedValue({ packageNotes: {}, files: [] });
    vi.mocked(parseVersionOutput).mockReturnValue({ ...twoPackageInput, packages: [...twoPackageInput.packages] });
    vi.mocked(fs.readFileSync).mockReturnValue('{}');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should return a command named notes', () => {
    expect(createNotesCommand().name()).toBe('notes');
  });

  it('should have generate, init, auth, and providers subcommands', () => {
    const names = createNotesCommand().commands.map((c) => c.name());
    expect(names).toContain('generate');
    expect(names).toContain('init');
    expect(names).toContain('auth');
    expect(names).toContain('providers');
  });

  describe('generate subcommand', () => {
    async function runGenerate(args: string[] = []): Promise<void> {
      await createNotesCommand().parseAsync(['node', 'test', 'generate', '--input', 'test.json', ...args]);
    }

    function capturedConfig(): Config {
      return vi.mocked(runPipeline).mock.calls[0][1] as Config;
    }

    it('should call runPipeline', async () => {
      await runGenerate();
      expect(runPipeline).toHaveBeenCalled();
    });

    describe('config mutations', () => {
      it('should set updateStrategy to regenerate with --regenerate', async () => {
        await runGenerate(['--regenerate']);
        expect(capturedConfig().updateStrategy).toBe('regenerate');
      });

      it('should set config.templates.path with --template', async () => {
        await runGenerate(['--template', './my-template.liquid']);
        expect(capturedConfig().templates?.path).toBe('./my-template.liquid');
      });

      it('should set config.templates.engine with --engine', async () => {
        await runGenerate(['--engine', 'handlebars']);
        expect(capturedConfig().templates?.engine).toBe('handlebars');
      });

      it('should set config.monorepo.mode with --monorepo', async () => {
        await runGenerate(['--monorepo', 'root']);
        expect(capturedConfig().monorepo?.mode).toBe('root');
      });

      it('should set config.output with --output', async () => {
        await runGenerate(['--output', 'markdown:RELEASES.md']);
        expect(capturedConfig().output).toEqual([{ format: 'markdown', file: 'RELEASES.md' }]);
      });

      it('should fall back to default output when config.output is empty and no --output given', async () => {
        vi.mocked(loadConfig).mockReturnValue({ ...baseConfig, output: [] });

        await runGenerate();

        expect(getDefaultConfig).toHaveBeenCalled();
      });

      it('should pass dryRun=true to runPipeline with --dry-run', async () => {
        await runGenerate(['--dry-run']);
        expect(runPipeline).toHaveBeenCalledWith(expect.anything(), expect.anything(), true);
      });

      it('should pass dryRun=false to runPipeline without --dry-run', async () => {
        await runGenerate();
        expect(runPipeline).toHaveBeenCalledWith(expect.anything(), expect.anything(), false);
      });
    });

    describe('LLM config', () => {
      it('should set config.llm.provider with --llm-provider', async () => {
        await runGenerate(['--llm-provider', 'openai']);
        expect(capturedConfig().llm?.provider).toBe('openai');
      });

      it('should set config.llm.model with --llm-model', async () => {
        await runGenerate(['--llm-model', 'gpt-4o']);
        expect(capturedConfig().llm?.model).toBe('gpt-4o');
      });

      it('should set config.llm.baseURL with --llm-base-url', async () => {
        await runGenerate(['--llm-base-url', 'http://localhost:11434']);
        expect(capturedConfig().llm?.baseURL).toBe('http://localhost:11434');
      });

      it('should parse --llm-tasks into task flags', async () => {
        await runGenerate(['--llm-provider', 'openai', '--llm-tasks', 'enhance,summarize']);
        expect(capturedConfig().llm?.tasks).toEqual(
          expect.objectContaining({ enhance: true, summarize: true, categorize: false }),
        );
      });

      it('should include releaseNotes task when release-notes is in --llm-tasks', async () => {
        await runGenerate(['--llm-provider', 'openai', '--llm-tasks', 'release-notes']);
        expect(capturedConfig().llm?.tasks?.releaseNotes).toBe(true);
      });

      it('should delete config.llm with --no-llm', async () => {
        vi.mocked(loadConfig).mockReturnValue({ ...baseConfig, llm: { provider: 'openai', model: 'gpt-4o' } });

        await runGenerate(['--no-llm']);

        expect(capturedConfig().llm).toBeUndefined();
      });
    });

    describe('target filtering', () => {
      it('should filter input to the named package with --target', async () => {
        await runGenerate(['--target', 'pkg-a']);

        const [inputArg] = vi.mocked(runPipeline).mock.calls[0];
        expect((inputArg as ChangelogInput).packages).toHaveLength(1);
        expect((inputArg as ChangelogInput).packages[0]?.packageName).toBe('pkg-a');
      });

      it('should not call runPipeline when --target matches no package', async () => {
        await runGenerate(['--target', 'unknown-pkg']);

        expect(runPipeline).not.toHaveBeenCalled();
      });
    });
  });

  describe('init subcommand', () => {
    it('should write a config file when none exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);

      createNotesCommand().parse(['node', 'test', 'init']);

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        'releasekit.config.json',
        expect.stringContaining('"notes"'),
        'utf-8',
      );
    });

    it('should exit with an error when config already exists and --force is not set', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      createNotesCommand().parse(['node', 'test', 'init']);

      expect(mockExit).toHaveBeenCalledWith(expect.any(Number));
      mockExit.mockRestore();
    });
  });
});
