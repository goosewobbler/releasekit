import { createFakeGit, type Git } from '@releasekit/git';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  commitTouchesAnyPackage,
  extractAllChangelogEntriesWithHash,
  extractChangelogEntriesFromCommits,
  extractChangelogEntriesWithHash,
  extractRepoLevelChangelogEntries,
} from '../../../src/changelog/commitParser.js';

// Mock logging only; git log / diff-tree are driven through an injected FakeGit.
vi.mock('../../../src/utils/logging.js', () => ({
  log: vi.fn(),
}));

const RANGE = 'v1.0.0..v1.1.0';

/** A FakeGit returning `output` for any `git log` (catch-all range), optionally with diff-tree names. */
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

    const entries = await extractChangelogEntriesFromCommits('/test', RANGE, gitWithLog(mockGitOutput));

    expect(entries).toHaveLength(11); // every conventional type is surfaced, including 'test'

    expect(entries.find((e) => e.description === 'add new feature')).toEqual(
      expect.objectContaining({ type: 'added', scope: 'core' }),
    );
    expect(entries.find((e) => e.description === 'resolve layout issue')).toEqual(
      expect.objectContaining({ type: 'fixed', scope: 'ui' }),
    );
    expect(entries.find((e) => e.description === 'update README')).toEqual(
      expect.objectContaining({ type: 'changed', scope: undefined }),
    );
    // `test:` is categorized as Changed, not dropped.
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

    const entries = await extractChangelogEntriesFromCommits('/test', RANGE, gitWithLog(mockGitOutput));

    expect(entries).toHaveLength(2);
    expect(entries[0].description).toContain('**BREAKING**');
    expect(entries[1].description).toContain('**BREAKING**');
  });

  it('should extract issue IDs from commit messages', async () => {
    const mockGitOutput = [
      'fix(api): fix bug\n\nFixes #123',
      'feat(ui): add feature\n\nCloses #456\nResolves #789',
    ].join('---COMMIT_DELIMITER---');

    const entries = await extractChangelogEntriesFromCommits('/test', RANGE, gitWithLog(mockGitOutput));

    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.description === 'fix bug')?.issueIds).toContain('#123');

    const featureEntry = entries.find((e) => e.description === 'add feature');
    expect(featureEntry?.issueIds).toContain('#456');
    expect(featureEntry?.issueIds).toContain('#789');
  });

  it('should treat a trailing (#N) on the subject as the PR and strip it from the description', async () => {
    const mockGitOutput = ['feat(release): hierarchical selection (#471)'].join('---COMMIT_DELIMITER---');

    const entries = await extractChangelogEntriesFromCommits('/test', RANGE, gitWithLog(mockGitOutput));

    expect(entries).toHaveLength(1);
    expect(entries[0].description).toBe('hierarchical selection');
    expect(entries[0].prNumber).toBe('#471');
    // The PR number is also kept in the full flat issueIds list.
    expect(entries[0].issueIds).toEqual(['#471']);
  });

  it('should separate the squash-merge PR from the issues its body closes', async () => {
    const mockGitOutput = ['fix(api): patch serializer (#503)\n\nCloses #500\nFixes #499'].join(
      '---COMMIT_DELIMITER---',
    );

    const entries = await extractChangelogEntriesFromCommits('/test', RANGE, gitWithLog(mockGitOutput));

    expect(entries).toHaveLength(1);
    expect(entries[0].description).toBe('patch serializer');
    expect(entries[0].prNumber).toBe('#503');
    // PR first, then the closed issues in body order — the full flat list.
    expect(entries[0].issueIds).toEqual(['#503', '#500', '#499']);
  });

  it('should leave prNumber undefined when the subject has no trailing (#N)', async () => {
    const mockGitOutput = ['fix(api): fix bug\n\nFixes #123'].join('---COMMIT_DELIMITER---');

    const entries = await extractChangelogEntriesFromCommits('/test', RANGE, gitWithLog(mockGitOutput));

    expect(entries).toHaveLength(1);
    expect(entries[0].prNumber).toBeUndefined();
    expect(entries[0].issueIds).toEqual(['#123']);
  });

  it('should handle non-conventional commits', async () => {
    const mockGitOutput = ['Add new feature', 'Fix bug in login', 'Merge pull request #123', 'v1.0.0'].join(
      '---COMMIT_DELIMITER---',
    );

    const entries = await extractChangelogEntriesFromCommits('/test', RANGE, gitWithLog(mockGitOutput));

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

    const entries = await extractChangelogEntriesFromCommits('/test', RANGE, gitWithLog(mockGitOutput));

    // The three version-sync subjects never become entries; the real change and the false-positive
    // guard ("update version handling …") both survive.
    expect(entries.map((e) => e.description)).toEqual(['Add real feature', 'update version handling in the parser']);
  });

  it('should handle errors when extracting commits', async () => {
    const git = createFakeGit();
    git.log = async () => {
      throw new Error('Git command failed');
    };

    const entries = await extractChangelogEntriesFromCommits('/test', RANGE, git);

    expect(entries).toEqual([]);
  });

  describe('extractChangelogEntriesWithHash', () => {
    it('should extract changelog entries with commit hashes', async () => {
      const mockGitOutput = ['abc123|||feat(core): add new feature', 'def456|||fix(ui): resolve layout issue'].join(
        '---COMMIT_DELIMITER---',
      );

      const entries = await extractChangelogEntriesWithHash('/test', RANGE, gitWithLog(mockGitOutput));

      expect(entries).toHaveLength(2);
      expect(entries[0].hash).toBe('abc123');
      expect(entries[0].entry.description).toBe('add new feature');
      expect(entries[1].hash).toBe('def456');
      expect(entries[1].entry.description).toBe('resolve layout issue');
    });

    it('should filter commits to the package path', async () => {
      // The seam's log() appends `-- <paths>` when paths are given; assert the seam received `['.']`.
      const git = createFakeGit({ commits: { '*': 'abc123|||feat(core): add new feature' } });
      const logSpy = vi.spyOn(git, 'log');

      await extractChangelogEntriesWithHash('/test', RANGE, git);

      expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ paths: ['.'], extraArgs: ['--no-merges'] }));
    });
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

      // No `paths` → no `-- .` path filter on the underlying git log.
      const opts = logSpy.mock.calls[0]?.[0];
      expect(opts?.paths).toBeUndefined();
      expect(opts?.extraArgs).toEqual(['--no-merges']);
    });
  });

  describe('commitTouchesAnyPackage', () => {
    it('should return true when a commit touches a package directory', async () => {
      const git = createFakeGit({
        diffNames: { abc123: ['packages/version/src/index.ts', 'packages/version/package.json'] },
      });

      const result = await commitTouchesAnyPackage('/test', 'abc123', ['packages/version', 'packages/notes'], [], git);

      expect(result).toBe(true);
    });

    it('should return false when a commit only touches repo-level files', async () => {
      const git = createFakeGit({ diffNames: { abc123: ['.github/workflows/ci.yml', 'README.md'] } });

      const result = await commitTouchesAnyPackage('/test', 'abc123', ['packages/version', 'packages/notes'], [], git);

      expect(result).toBe(false);
    });

    it('should return false when a commit has no changed files', async () => {
      const git = createFakeGit({ diffNames: { abc123: [] } });

      const result = await commitTouchesAnyPackage('/test', 'abc123', ['packages/version'], [], git);

      expect(result).toBe(false);
    });

    it('should return false for shared packages when sharedPackageDirs is provided', async () => {
      const git = createFakeGit({
        diffNames: { abc123: ['packages/core/src/index.ts', 'packages/core/package.json'] },
      });

      const result = await commitTouchesAnyPackage(
        '/test',
        'abc123',
        ['packages/version', 'packages/core'],
        ['packages/core'],
        git,
      );

      expect(result).toBe(false);
    });

    it('should return true for non-shared packages even when other packages are shared', async () => {
      const git = createFakeGit({ diffNames: { abc123: ['packages/version/src/index.ts'] } });

      const result = await commitTouchesAnyPackage(
        '/test',
        'abc123',
        ['packages/version', 'packages/core'],
        ['packages/core'],
        git,
      );

      expect(result).toBe(true);
    });
  });

  describe('extractRepoLevelChangelogEntries', () => {
    it('should extract only commits that do not touch any package directory', async () => {
      // log returns two commits; diff-tree names per commit decide repo-level membership.
      const git = createFakeGit({
        commits: {
          '*': 'aaa123|||feat(version): add feature\n---COMMIT_DELIMITER---\nbbb456|||chore(ci): update workflow',
        },
        diffNames: {
          aaa123: ['packages/version/src/feature.ts'], // touches the version package
          bbb456: ['.github/workflows/ci.yml'], // CI only → repo-level
        },
      });

      const entries = await extractRepoLevelChangelogEntries('/test', RANGE, ['packages/version'], [], git);

      expect(entries).toHaveLength(1);
      expect(entries[0].description).toBe('update workflow');
    });

    it('should return an empty array when all commits touch packages', async () => {
      const git = createFakeGit({
        commits: {
          '*': 'abc123|||feat(version): feature\n---COMMIT_DELIMITER---\ndef456|||fix(notes): bugfix',
        },
        diffNames: {
          abc123: ['packages/version/src/index.ts'],
          def456: ['packages/notes/src/index.ts'],
        },
      });

      const entries = await extractRepoLevelChangelogEntries(
        '/test',
        RANGE,
        ['packages/version', 'packages/notes'],
        [],
        git,
      );

      expect(entries).toHaveLength(0);
    });

    it('should include a commit when it touches shared directories', async () => {
      const git = createFakeGit({
        commits: { '*': 'shared123|||chore: update shared config' },
        diffNames: { shared123: ['shared/config.js'] }, // touches a shared dir, not a package
      });

      const entries = await extractRepoLevelChangelogEntries('/test', RANGE, ['packages/version'], [], git);

      expect(entries).toHaveLength(1);
      expect(entries[0].description).toBe('update shared config');
    });

    it('should treat commits to shared packages as repo-level', async () => {
      const git = createFakeGit({
        commits: { '*': 'core123|||feat(core): add new utility' },
        diffNames: { core123: ['packages/core/src/index.ts'] },
      });

      const entries = await extractRepoLevelChangelogEntries(
        '/test',
        RANGE,
        ['packages/version', 'packages/core'],
        ['packages/core'],
        git,
      );

      expect(entries).toHaveLength(1);
      expect(entries[0].description).toBe('add new utility');
    });

    it('should exclude commits to non-shared packages from repo-level', async () => {
      const git = createFakeGit({
        commits: { '*': 'version123|||feat(version): add feature' },
        diffNames: { version123: ['packages/version/src/index.ts'] },
      });

      const entries = await extractRepoLevelChangelogEntries(
        '/test',
        RANGE,
        ['packages/version', 'packages/core'],
        ['packages/core'],
        git,
      );

      expect(entries).toHaveLength(0);
    });
  });
});
