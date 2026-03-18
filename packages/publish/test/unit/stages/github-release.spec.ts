import * as fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultConfig } from '../../../src/config.js';
import { runGithubReleaseStage } from '../../../src/stages/github-release.js';
import type { PipelineContext } from '../../../src/types.js';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, readFileSync: vi.fn() };
});

vi.mock('../../../src/utils/exec.js', () => ({
  execCommand: vi
    .fn()
    .mockResolvedValue({ stdout: 'https://github.com/owner/repo/releases/tag/v1.0.0', stderr: '', exitCode: 0 }),
}));

function createContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    input: { dryRun: false, updates: [], changelogs: [], tags: ['v1.0.0'] },
    config: getDefaultConfig(),
    cliOptions: {
      registry: 'all',
      npmAuth: 'auto',
      dryRun: false,
      skipGit: false,
      skipPublish: false,
      skipGithubRelease: false,
      skipVerification: false,

      json: false,
      verbose: false,
    },
    cwd: '/test',
    packageManager: 'pnpm',
    output: {
      dryRun: false,
      git: { committed: true, tags: ['v1.0.0'], pushed: true },
      npm: [],
      cargo: [],
      verification: [],
      githubReleases: [],
    },
    ...overrides,
  };
}

describe('github-release stage', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { execCommand } = await import('../../../src/utils/exec.js');
    vi.mocked(execCommand).mockResolvedValue({
      stdout: 'https://github.com/owner/repo/releases/tag/v1.0.0',
      stderr: '',
      exitCode: 0,
    });
    // Default: no RELEASE_NOTES.md on disk
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });
  });

  it('should fall back to --generate-notes when notes is auto and no files/changelogs exist', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const ctx = createContext();

    await runGithubReleaseStage(ctx);

    expect(execCommand).toHaveBeenCalledTimes(1);
    const args = vi.mocked(execCommand).mock.calls[0]?.[1] as string[];
    expect(args).toEqual(expect.arrayContaining(['release', 'create', 'v1.0.0']));
    expect(args).toContain('--draft');
    expect(args).toContain('--generate-notes');

    expect(ctx.output.githubReleases).toHaveLength(1);
    expect(ctx.output.githubReleases[0]?.success).toBe(true);
    expect(ctx.output.githubReleases[0]?.draft).toBe(true);
  });

  it('should use in-memory per-package notes when notes is auto', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');

    const ctx = createContext({
      input: { dryRun: false, updates: [], changelogs: [], tags: ['@my/pkg@v1.0.0'] },
      output: {
        dryRun: false,
        git: { committed: true, tags: ['@my/pkg@v1.0.0'], pushed: true },
        npm: [],
        cargo: [],
        verification: [],
        githubReleases: [],
      },
      releaseNotes: { '@my/pkg': '## 1.0.0\n\n- Enhanced notes from pipeline' },
    });

    await runGithubReleaseStage(ctx);

    const args = vi.mocked(execCommand).mock.calls[0]?.[1] as string[];
    expect(args).toContain('--notes');
    expect(args).toContain('## 1.0.0\n\n- Enhanced notes from pipeline');
    expect(args).not.toContain('--generate-notes');
  });

  it('should use per-package changelog entries when notes is auto and no file exists', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');

    const ctx = createContext({
      input: {
        dryRun: false,
        updates: [],
        changelogs: [
          {
            packageName: 'pkg-a',
            version: '1.0.0',
            previousVersion: '0.9.0',
            revisionRange: 'v0.9.0..HEAD',
            repoUrl: null,
            entries: [
              { type: 'feat', description: 'add new feature', scope: 'core' },
              { type: 'fix', description: 'fix a bug' },
            ],
          },
        ],
        tags: ['pkg-a@v1.0.0'],
      },
      output: {
        dryRun: false,
        git: { committed: true, tags: ['pkg-a@v1.0.0'], pushed: true },
        npm: [],
        cargo: [],
        verification: [],
        githubReleases: [],
      },
    });

    await runGithubReleaseStage(ctx);

    const args = vi.mocked(execCommand).mock.calls[0]?.[1] as string[];
    expect(args).toContain('--notes');
    const notesIndex = args.indexOf('--notes');
    const notesBody = args[notesIndex + 1];
    expect(notesBody).toContain('**core:** add new feature');
    expect(notesBody).toContain('fix a bug');
    expect(args).not.toContain('--generate-notes');
  });

  it('should not false-match notes when package name is a prefix of another', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');

    const ctx = createContext({
      input: { dryRun: false, updates: [], changelogs: [], tags: ['@scope/pkg-extra@v1.0.0'] },
      output: {
        dryRun: false,
        git: { committed: true, tags: ['@scope/pkg-extra@v1.0.0'], pushed: true },
        npm: [],
        cargo: [],
        verification: [],
        githubReleases: [],
      },
      releaseNotes: { '@scope/pkg': 'Wrong package notes' },
    });

    await runGithubReleaseStage(ctx);

    const args = vi.mocked(execCommand).mock.calls[0]?.[1] as string[];
    // Should NOT use @scope/pkg notes for @scope/pkg-extra tag
    expect(args).not.toContain('Wrong package notes');
    expect(args).toContain('--generate-notes');
  });

  it('should not false-match changelogs when package name is a prefix of another', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');

    const ctx = createContext({
      input: {
        dryRun: false,
        updates: [],
        changelogs: [
          {
            packageName: 'pkg-a',
            version: '1.0.0',
            previousVersion: '0.9.0',
            revisionRange: 'v0.9.0..HEAD',
            repoUrl: null,
            entries: [{ type: 'feat', description: 'wrong match' }],
          },
        ],
        tags: ['pkg-ab@v1.0.0'],
      },
      output: {
        dryRun: false,
        git: { committed: true, tags: ['pkg-ab@v1.0.0'], pushed: true },
        npm: [],
        cargo: [],
        verification: [],
        githubReleases: [],
      },
    });

    await runGithubReleaseStage(ctx);

    const args = vi.mocked(execCommand).mock.calls[0]?.[1] as string[];
    // Should NOT match pkg-a changelog for pkg-ab tag
    expect(args).toContain('--generate-notes');
    expect(args).not.toContain('--notes');
  });

  it('should always use --generate-notes when notes is github', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const config = getDefaultConfig();
    config.githubRelease.releaseNotes = 'github';

    const ctx = createContext({ config });
    await runGithubReleaseStage(ctx);

    const args = vi.mocked(execCommand).mock.calls[0]?.[1] as string[];
    expect(args).toContain('--generate-notes');
    expect(args).not.toContain('--notes');
  });

  it('should pass no notes flags when notes is none', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const config = getDefaultConfig();
    config.githubRelease.releaseNotes = 'none';

    const ctx = createContext({ config });
    await runGithubReleaseStage(ctx);

    const args = vi.mocked(execCommand).mock.calls[0]?.[1] as string[];
    expect(args).not.toContain('--generate-notes');
    expect(args).not.toContain('--notes');
  });

  it('should read from explicit file path when notes is a path', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    vi.mocked(fs.readFileSync).mockImplementation((filePath) => {
      if (String(filePath) === './my-notes.md') return 'Notes from custom file';
      throw new Error('ENOENT');
    });

    const config = getDefaultConfig();
    config.githubRelease.releaseNotes = './my-notes.md';

    const ctx = createContext({ config });
    await runGithubReleaseStage(ctx);

    const args = vi.mocked(execCommand).mock.calls[0]?.[1] as string[];
    expect(args).toContain('--notes');
    expect(args).toContain('Notes from custom file');
  });

  it('should create per-package releases by default', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');

    const ctx = createContext({
      output: {
        dryRun: false,
        git: { committed: true, tags: ['pkg-a@v1.0.0', 'pkg-b@v1.0.0'], pushed: true },
        npm: [],
        cargo: [],
        verification: [],
        githubReleases: [],
      },
    });

    await runGithubReleaseStage(ctx);

    expect(execCommand).toHaveBeenCalledTimes(2);
    expect(ctx.output.githubReleases).toHaveLength(2);
  });

  it('should create single release when perPackage is false', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const config = getDefaultConfig();
    config.githubRelease.perPackage = false;

    const ctx = createContext({
      config,
      output: {
        dryRun: false,
        git: { committed: true, tags: ['pkg-a@v1.0.0', 'pkg-b@v1.0.0'], pushed: true },
        npm: [],
        cargo: [],
        verification: [],
        githubReleases: [],
      },
    });

    await runGithubReleaseStage(ctx);

    expect(execCommand).toHaveBeenCalledTimes(1);
    expect(ctx.output.githubReleases).toHaveLength(1);
  });

  it('should add --prerelease for pre-release versions', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const ctx = createContext({
      output: {
        dryRun: false,
        git: { committed: true, tags: ['v1.0.0-next.1'], pushed: true },
        npm: [],
        cargo: [],
        verification: [],
        githubReleases: [],
      },
    });

    await runGithubReleaseStage(ctx);

    const args = vi.mocked(execCommand).mock.calls[0]?.[1] as string[];
    expect(args).toContain('--prerelease');
  });

  it('should skip when disabled in config', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const config = getDefaultConfig();
    config.githubRelease.enabled = false;
    const ctx = createContext({ config });

    await runGithubReleaseStage(ctx);

    expect(execCommand).not.toHaveBeenCalled();
  });

  it('should skip when no tags available', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const ctx = createContext({
      input: { dryRun: false, updates: [], changelogs: [], tags: [] },
      output: {
        dryRun: false,
        git: { committed: true, tags: [], pushed: true },
        npm: [],
        cargo: [],
        verification: [],
        githubReleases: [],
      },
    });

    await runGithubReleaseStage(ctx);

    expect(execCommand).not.toHaveBeenCalled();
  });
});
