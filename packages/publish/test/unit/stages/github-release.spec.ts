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

  it('should match sanitized tag format (scope-pkg-vX.Y.Z) to scoped package name', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');

    const ctx = createContext({
      input: {
        dryRun: false,
        updates: [],
        changelogs: [
          {
            packageName: '@releasekit/version',
            version: '0.4.1',
            previousVersion: '0.4.0',
            revisionRange: 'releasekit-version-v0.4.0..HEAD',
            repoUrl: null,
            entries: [{ type: 'fix', description: 'create per-package tags' }],
          },
        ],
        tags: ['releasekit-version-v0.4.1'],
      },
      output: {
        dryRun: false,
        git: { committed: true, tags: ['releasekit-version-v0.4.1'], pushed: true },
        npm: [],
        cargo: [],
        verification: [],
        githubReleases: [],
      },
    });

    await runGithubReleaseStage(ctx);

    const args = vi.mocked(execCommand).mock.calls[0]?.[1] as string[];
    // Title should use original package name, not sanitized tag prefix
    expect(args).toContain('--title');
    expect(args[args.indexOf('--title') + 1]).toBe('@releasekit/version: v0.4.1');
    // Body should use changelog content, not --generate-notes
    expect(args).toContain('--notes');
    expect(args).not.toContain('--generate-notes');
    expect(args[args.indexOf('--notes') + 1]).toContain('create per-package tags');
  });

  it('should match sanitized tag to release notes keyed by scoped package name', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');

    const ctx = createContext({
      input: { dryRun: false, updates: [], changelogs: [], tags: ['releasekit-version-v0.4.1'] },
      output: {
        dryRun: false,
        git: { committed: true, tags: ['releasekit-version-v0.4.1'], pushed: true },
        npm: [],
        cargo: [],
        verification: [],
        githubReleases: [],
      },
      releaseNotes: { '@releasekit/version': 'LLM-enhanced release notes' },
    });

    await runGithubReleaseStage(ctx);

    const args = vi.mocked(execCommand).mock.calls[0]?.[1] as string[];
    expect(args).toContain('--notes');
    expect(args[args.indexOf('--notes') + 1]).toBe('LLM-enhanced release notes');
    expect(args).not.toContain('--generate-notes');
    // Title should be resolved via the releaseNotes keys even though changelogs is empty
    expect(args[args.indexOf('--title') + 1]).toBe('@releasekit/version: v0.4.1');
  });

  it('should always use --generate-notes when body is generated', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const config = getDefaultConfig();
    config.githubRelease.body = 'generated';

    const ctx = createContext({ config });
    await runGithubReleaseStage(ctx);

    const args = vi.mocked(execCommand).mock.calls[0]?.[1] as string[];
    expect(args).toContain('--generate-notes');
    expect(args).not.toContain('--notes');
  });

  it('should pass no notes flags when body is none', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const config = getDefaultConfig();
    config.githubRelease.body = 'none';

    const ctx = createContext({ config });
    await runGithubReleaseStage(ctx);

    const args = vi.mocked(execCommand).mock.calls[0]?.[1] as string[];
    expect(args).not.toContain('--generate-notes');
    expect(args).not.toContain('--notes');
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

  it('should use version-only title for version-only tags', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const ctx = createContext({
      output: {
        dryRun: false,
        git: { committed: true, tags: ['v1.0.0'], pushed: true },
        npm: [],
        cargo: [],
        verification: [],
        githubReleases: [],
      },
    });

    await runGithubReleaseStage(ctx);

    const args = vi.mocked(execCommand).mock.calls[0]?.[1] as string[];
    const titleIndex = args.indexOf('--title');
    expect(args[titleIndex + 1]).toBe('v1.0.0');
  });

  it('should include package name in title for package-specific tags', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const ctx = createContext({
      output: {
        dryRun: false,
        git: { committed: true, tags: ['@releasekit/release@v1.0.0'], pushed: true },
        npm: [],
        cargo: [],
        verification: [],
        githubReleases: [],
      },
    });

    await runGithubReleaseStage(ctx);

    const args = vi.mocked(execCommand).mock.calls[0]?.[1] as string[];
    const titleIndex = args.indexOf('--title');
    expect(args[titleIndex + 1]).toBe('@releasekit/release: v1.0.0');
  });

  it('should apply a custom titleTemplate', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const config = getDefaultConfig();
    config.githubRelease.titleTemplate = '${packageName} @ ${version}';

    const ctx = createContext({
      config,
      output: {
        dryRun: false,
        git: { committed: true, tags: ['@releasekit/release@v1.0.0'], pushed: true },
        npm: [],
        cargo: [],
        verification: [],
        githubReleases: [],
      },
    });

    await runGithubReleaseStage(ctx);

    const args = vi.mocked(execCommand).mock.calls[0]?.[1] as string[];
    expect(args[args.indexOf('--title') + 1]).toBe('@releasekit/release @ v1.0.0');
  });

  it('should include package name in title for non-scoped package tags', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const ctx = createContext({
      output: {
        dryRun: false,
        git: { committed: true, tags: ['my-package@v1.0.0'], pushed: true },
        npm: [],
        cargo: [],
        verification: [],
        githubReleases: [],
      },
    });

    await runGithubReleaseStage(ctx);

    const args = vi.mocked(execCommand).mock.calls[0]?.[1] as string[];
    const titleIndex = args.indexOf('--title');
    expect(args[titleIndex + 1]).toBe('my-package: v1.0.0');
  });
});
