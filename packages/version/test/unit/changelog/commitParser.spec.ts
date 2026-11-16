import { createFakeGit, type Git } from '@releasekit/git';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  extractAllChangelogEntriesWithHash,
  extractChangelogEntriesFromCommits,
  extractRepoLevelChangelogEntries,
} from '../../../src/changelog/commitParser.js';

vi.mock('../../../src/utils/logging.js', () => ({
  log: vi.fn(),
}));

const RANGE = 'v1.0.0..v1.1.0';

const gitWithLog = (output: string, diffNames?: Record<string, string[]>): Git =>
  createFakeGit({ commits: { '*': output }, diffNames });

describe('Commit Parser', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should extract changelog entries from conventional commits', async () => {
    const mockGitOutput = [
      'feat(core): add new feature',
      'fix(ui): resolve layout issue',
      'docs: update README',
      'chore: update dependencies',
      'refactor(api): simplify logic',
      'test: add new tests',
      'style: format code',
      'perf(core): improve performance',
      'build: update build config',
      'ci: update CI workflow',
      'revert: revert previous commit',
    ].join('---COMMIT_DELIMITER---');

    const entries = await extractChangelogEntriesFromCommits('/test', RANGE, ['.'], gitWithLog(mockGitOutput));

    expect(entries).toHaveLength(11);

    expect(entries.find((e) => e.description === 'add new feature')).toEqual(
      expect.objectContaining({ type: 'added', scope: 'core' }),
    );
    expect(entries.find((e) => e.description === 'resolve layout issue')).toEqual(
      expect.objectContaining({ type: 'fixed', scope: 'ui' }),
    );
    expect(entries.find((e) => e.description === 'update README')).toEqual(
      expect.objectContaining({ type: 'changed', scope: undefined }),
    );
    // `test:` maps to Changed rather than being dropped.
    expect(entries.find((e) => e.description === 'add new tests')).toEqual(
      expect.objectContaining({ type: 'changed', scope: undefined }),
    );
    expect(entries.find((e) => e.description === 'revert previous commit')).toEqual(
      expect.objectContaining({ type: 'removed', scope: undefined }),
    );
  });

  it('should extract breaking changes from commit messages', async () => {
    const mockGitOutput = [
      'feat(core)!: breaking change',
      'fix(api): another fix\n\nBREAKING CHANGE: This breaks the API',
    ].join('---COMMIT_DELIMITER---');

    const entries = await extractChangelogEntriesFromCommits('/test', RANGE, ['.'], gitWithLog(mockGitOutput));

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ description: 'breaking change', breaking: true });
    expect(entries[1]).toMatchObject({ description: 'another fix', breaking: true });
  });

  it('should extract issue IDs from commit messages', async () => {
    const mockGitOutput = [
      'fix(api): fix bug\n\nFixes #123',
      'feat(ui): add feature\n\nCloses #456\nResolves #789',
    ].join('---COMMIT_DELIMITER---');

    const entries = await extractChangelogEntriesFromCommits('/test', RANGE, ['.'], gitWithLog(mockGitOutput));

    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.description === 'fix bug')?.issueIds).toContain('#123');

    const featureEntry = entries.find((e) => e.description === 'add feature');
    expect(featureEntry?.issueIds).toContain('#456');
    expect(featureEntry?.issueIds).toContain('#789');
  });

  it('should treat a trailing (#N) on the subject as the PR and strip it from the description', async () => {
    const mockGitOutput = ['feat(release): hierarchical selection (#471)'].join('---COMMIT_DELIMITER---');

    const entries = await extractChangelogEntriesFromCommits('/test', RANGE, ['.'], gitWithLog(mockGitOutput));

    expect(entries).toHaveLength(1);
    expect(entries[0].description).toBe('hierarchical selection');
    expect(entries[0].prNumber).toBe('#471');
    expect(entries[0].issueIds).toEqual(['#471']);
  });

  it('should separate the squash-merge PR from the issues its body closes', async () => {
    const mockGitOutput = ['fix(api): patch serializer (#503)\n\nCloses #500\nFixes #499'].join(
      '---COMMIT_DELIMITER---',
    );

    const entries = await extractChangelogEntriesFromCommits('/test', RANGE, ['.'], gitWithLog(mockGitOutput));

    expect(entries).toHaveLength(1);
    expect(entries[0].description).toBe('patch serializer');
    expect(entries[0].prNumber).toBe('#503');
    // PR first, then closed issues in body order.
    expect(entries[0].issueIds).toEqual(['#503', '#500', '#499']);
  });

  it('should leave prNumber undefined when the subject has no trailing (#N)', async () => {
    const mockGitOutput = ['fix(api): fix bug\n\nFixes #123'].join('---COMMIT_DELIMITER---');

    const entries = await extractChangelogEntriesFromCommits('/test', RANGE, ['.'], gitWithLog(mockGitOutput));

    expect(entries).toHaveLength(1);
    expect(entries[0].prNumber).toBeUndefined();
    expect(entries[0].issueIds).toEqual(['#123']);
  });

  it('should handle non-conventional commits', async () => {
    const mockGitOutput = ['Add new feature', 'Fix bug in login', 'Merge pull request #123', 'v1.0.0'].join(
      '---COMMIT_DELIMITER---',
    );

    const entries = await extractChangelogEntriesFromCommits('/test', RANGE, ['.'], gitWithLog(mockGitOutput));

    expect(entries).toHaveLength(2);
    expect(entries[0].type).toBe('changed');
    expect(entries[1].type).toBe('changed');
    expect(entries.map((e) => e.description)).toContain('Add new feature');
    expect(entries.map((e) => e.description)).toContain('Fix bug in login');
  });

  it('should drop version-sync / release-bump bookkeeping subjects', async () => {
    const mockGitOutput = [
      'Update version to 0.2.0',
      'Update version to 1.2.3 (wdio_flutter)',
      'update package versions across multiple packages',
      'Add real feature',
      'update version handling in the parser',
    ].join('---COMMIT_DELIMITER---');

    const entries = await extractChangelogEntriesFromCommits('/test', RANGE, ['.'], gitWithLog(mockGitOutput));

    // The three version-sync subjects never become entries; the real change and the false-positive
    // guard ("update version handling …") both survive.
    expect(entries.map((e) => e.description)).toEqual(['Add real feature', 'update version handling in the parser']);
  });

  it('should handle errors when extracting commits', async () => {
    const git = createFakeGit();
    git.log = async () => {
      throw new Error('Git command failed');
    };

    const entries = await extractChangelogEntriesFromCommits('/test', RANGE, ['.'], git);

    expect(entries).toEqual([]);
  });

  describe('extractAllChangelogEntriesWithHash', () => {
    it('should extract all changelog entries including repo-level commits', async () => {
      const mockGitOutput = [
        'abc123|||feat(core): add new feature',
        'def456|||chore(deps): bump actions/upload-artifact from 4 to 7',
      ].join('---COMMIT_DELIMITER---');

      const entries = await extractAllChangelogEntriesWithHash('/test', RANGE, gitWithLog(mockGitOutput));

      expect(entries).toHaveLength(2);
      expect(entries[0].hash).toBe('abc123');
      expect(entries[1].hash).toBe('def456');
      expect(entries[1].entry.description).toBe('bump actions/upload-artifact from 4 to 7');
    });

    it('should not filter to the package path', async () => {
      const git = createFakeGit({ commits: { '*': 'abc123|||feat(core): add new feature' } });
      const logSpy = vi.spyOn(git, 'log');

      await extractAllChangelogEntriesWithHash('/test', RANGE, git);

      const opts = logSpy.mock.calls[0]?.[0];
      expect(opts?.paths).toBeUndefined();
      expect(opts?.extraArgs).toEqual(['--no-merges']);
    });
  });

  describe('extractRepoLevelChangelogEntries', () => {
    const repoGit = (log: string, diffNames: Record<string, string[]>) =>
      createFakeGit({ topLevel: '/repo', commits: { '*': log }, diffNames });

    it('should extract only commits that do not touch any package directory', async () => {
      const git = repoGit(
        'aaa123|||feat(version): add feature\n---COMMIT_DELIMITER---\nbbb456|||chore(ci): update workflow',
        { aaa123: ['packages/version/src/feature.ts'], bbb456: ['.github/workflows/ci.yml'] },
      );

      const entries = await extractRepoLevelChangelogEntries(
        '/repo/packages/version',
        RANGE,
        ['/repo/packages/version'],
        git,
      );

      expect(entries.map((e) => e.description)).toEqual(['update workflow']);
    });

    it('should return an empty array when all commits touch packages', async () => {
      const git = repoGit('abc123|||feat(version): feature\n---COMMIT_DELIMITER---\ndef456|||fix(notes): bugfix', {
        abc123: ['packages/version/src/index.ts'],
        def456: ['packages/notes/src/index.ts'],
      });

      const entries = await extractRepoLevelChangelogEntries(
        '/repo/packages/version',
        RANGE,
        ['/repo/packages/version', '/repo/packages/notes'],
        git,
      );

      expect(entries).toEqual([]);
    });

    it('should treat a commit with no changed files as repo-level', async () => {
      const git = repoGit('abc123|||chore: empty', { abc123: [] });

      const entries = await extractRepoLevelChangelogEntries(
        '/repo/packages/version',
        RANGE,
        ['/repo/packages/version'],
        git,
      );

      expect(entries.map((e) => e.description)).toEqual(['empty']);
    });

    it('should not count a sibling directory that shares a package directory prefix', async () => {
      const git = repoGit('abc123|||fix: tweak the cli', { abc123: ['packages/version-cli/index.ts'] });

      const entries = await extractRepoLevelChangelogEntries(
        '/repo/packages/version',
        RANGE,
        ['/repo/packages/version'],
        git,
      );

      expect(entries.map((e) => e.description)).toEqual(['tweak the cli']);
    });
  });
});
