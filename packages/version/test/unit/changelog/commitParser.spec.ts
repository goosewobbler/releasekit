import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  commitTouchesAnyPackage,
  extractAllChangelogEntriesWithHash,
  extractChangelogEntriesFromCommits,
  extractChangelogEntriesWithHash,
  extractRepoLevelChangelogEntries,
} from '../../../src/changelog/commitParser.js';

// Mock dependencies - vi.mock calls are hoisted to the top
vi.mock('../../../src/git/commandExecutor.js', () => ({
  execSync: vi.fn(),
}));

// Mock logging
vi.mock('../../../src/utils/logging.js', () => ({
  log: vi.fn(),
}));

// Import mocked modules
import { execSync } from '../../../src/git/commandExecutor.js';

describe('Commit Parser', () => {
  beforeEach(() => {
    // Reset mocks
    vi.resetAllMocks();
  });

  it('should extract changelog entries from conventional commits', () => {
    // Mock git output with conventional commits
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

    vi.mocked(execSync, { partial: true }).mockReturnValue(mockGitOutput as any);

    const entries = extractChangelogEntriesFromCommits('/test', 'v1.0.0..v1.1.0');

    // Verify entries were extracted correctly
    expect(entries).toHaveLength(10); // Should exclude 'test' commit

    // Verify types were mapped correctly
    expect(entries.find((e) => e.description === 'add new feature')).toEqual(
      expect.objectContaining({ type: 'added', scope: 'core' }),
    );
    expect(entries.find((e) => e.description === 'resolve layout issue')).toEqual(
      expect.objectContaining({ type: 'fixed', scope: 'ui' }),
    );
    expect(entries.find((e) => e.description === 'update README')).toEqual(
      expect.objectContaining({ type: 'changed', scope: undefined }),
    );
    expect(entries.find((e) => e.description === 'revert previous commit')).toEqual(
      expect.objectContaining({ type: 'removed', scope: undefined }),
    );
  });

  it('should extract breaking changes from commit messages', () => {
    // Mock git output with breaking changes
    const mockGitOutput = [
      'feat(core)!: breaking change',
      'fix(api): another fix\n\nBREAKING CHANGE: This breaks the API',
    ].join('---COMMIT_DELIMITER---');

    vi.mocked(execSync, { partial: true }).mockReturnValue(mockGitOutput as any);

    const entries = extractChangelogEntriesFromCommits('/test', 'v1.0.0..v1.1.0');

    // Should extract both breaking changes
    expect(entries).toHaveLength(2);
    expect(entries[0].description).toContain('**BREAKING**');
    expect(entries[1].description).toContain('**BREAKING**');
  });

  it('should extract issue IDs from commit messages', () => {
    // Mock git output with issue references
    const mockGitOutput = [
      'fix(api): fix bug\n\nFixes #123',
      'feat(ui): add feature\n\nCloses #456\nResolves #789',
    ].join('---COMMIT_DELIMITER---');

    vi.mocked(execSync, { partial: true }).mockReturnValue(mockGitOutput as any);

    const entries = extractChangelogEntriesFromCommits('/test', 'v1.0.0..v1.1.0');

    // Should extract issue IDs
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.description === 'fix bug')?.issueIds).toContain('#123');

    // Get the second entry's issueIds for more precise testing
    const featureEntry = entries.find((e) => e.description === 'add feature');
    expect(featureEntry?.issueIds).toContain('#456');
    expect(featureEntry?.issueIds).toContain('#789');
  });

  it('should handle non-conventional commits', () => {
    // Mock git output with non-conventional commits
    const mockGitOutput = ['Add new feature', 'Fix bug in login', 'Merge pull request #123', 'v1.0.0'].join(
      '---COMMIT_DELIMITER---',
    );

    vi.mocked(execSync, { partial: true }).mockReturnValue(mockGitOutput as any);

    const entries = extractChangelogEntriesFromCommits('/test', 'v1.0.0..v1.1.0');

    // Should extract meaningful commits and ignore merges and version tags
    expect(entries).toHaveLength(2);
    expect(entries[0].type).toBe('changed');
    expect(entries[1].type).toBe('changed');
    expect(entries.map((e) => e.description)).toContain('Add new feature');
    expect(entries.map((e) => e.description)).toContain('Fix bug in login');
  });

  it('should handle errors when extracting commits', () => {
    // Mock execSync to throw an error
    vi.mocked(execSync, { partial: true }).mockImplementation(() => {
      throw new Error('Git command failed');
    });

    const entries = extractChangelogEntriesFromCommits('/test', 'v1.0.0..v1.1.0');

    // Should return empty array on error
    expect(entries).toEqual([]);
  });

  describe('extractChangelogEntriesWithHash', () => {
    it('should extract changelog entries with commit hashes', () => {
      const mockGitOutput = ['abc123|||feat(core): add new feature', 'def456|||fix(ui): resolve layout issue'].join(
        '---COMMIT_DELIMITER---',
      );

      vi.mocked(execSync, { partial: true }).mockReturnValue(mockGitOutput as any);

      const entries = extractChangelogEntriesWithHash('/test', 'v1.0.0..v1.1.0');

      expect(entries).toHaveLength(2);
      expect(entries[0].hash).toBe('abc123');
      expect(entries[0].entry.description).toBe('add new feature');
      expect(entries[1].hash).toBe('def456');
      expect(entries[1].entry.description).toBe('resolve layout issue');
    });

    it('should filter commits to package path', () => {
      const mockGitOutput = 'abc123|||feat(core): add new feature';

      vi.mocked(execSync, { partial: true }).mockReturnValue(mockGitOutput as any);

      extractChangelogEntriesWithHash('/test', 'v1.0.0..v1.1.0');

      // Verify -- was added to filter to package path
      const calls = vi.mocked(execSync).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const gitArgs = calls[0][1] as string[];
      expect(gitArgs).toContain('--');
      expect(gitArgs).toContain('.');
    });
  });

  describe('extractAllChangelogEntriesWithHash', () => {
    it('should extract all changelog entries including repo-level commits', () => {
      const mockGitOutput = [
        'abc123|||feat(core): add new feature',
        'def456|||chore(deps): bump actions/upload-artifact from 4 to 7',
      ].join('---COMMIT_DELIMITER---');

      vi.mocked(execSync, { partial: true }).mockReturnValue(mockGitOutput as any);

      const entries = extractAllChangelogEntriesWithHash('/test', 'v1.0.0..v1.1.0');

      expect(entries).toHaveLength(2);
      expect(entries[0].hash).toBe('abc123');
      expect(entries[1].hash).toBe('def456');
      expect(entries[1].entry.description).toBe('bump actions/upload-artifact from 4 to 7');
    });

    it('does not filter to package path', () => {
      const mockGitOutput = 'abc123|||feat(core): add new feature';

      vi.mocked(execSync, { partial: true }).mockReturnValue(mockGitOutput as any);

      extractAllChangelogEntriesWithHash('/test', 'v1.0.0..v1.1.0');

      // Verify -- was NOT added (no path filtering)
      const calls = vi.mocked(execSync).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const gitArgs = calls[0][1] as string[];
      expect(gitArgs).not.toContain('--');
    });

    it('can identify global commits not in any package', () => {
      // Simulate: all commits (including CI) vs package-only commits
      const allCommits = [
        { hash: 'aaa111', entry: { type: 'added', description: 'feat: new feature', scope: 'core' } },
        { hash: 'bbb222', entry: { type: 'changed', description: 'chore: update CI', scope: undefined } },
        { hash: 'ccc333', entry: { type: 'fixed', description: 'fix: bug fix', scope: 'api' } },
      ];

      const packageCommits = [
        { hash: 'aaa111', entry: { type: 'added', description: 'feat: new feature', scope: 'core' } },
        { hash: 'ccc333', entry: { type: 'fixed', description: 'fix: bug fix', scope: 'api' } },
      ];

      // Global commits are those in all but not in package
      const packageHashes = new Set(packageCommits.map((c) => c.hash));
      const globalCommits = allCommits.filter((c) => !packageHashes.has(c.hash));

      expect(globalCommits).toHaveLength(1);
      expect(globalCommits[0].hash).toBe('bbb222');
      expect(globalCommits[0].entry.description).toBe('chore: update CI');
    });
  });

  describe('commitTouchesAnyPackage', () => {
    it('should return true when commit touches a package directory', () => {
      const mockDiffOutput = Buffer.from('packages/version/src/index.ts\npackages/version/package.json');

      vi.mocked(execSync, { partial: true }).mockReturnValue(mockDiffOutput as any);

      const result = commitTouchesAnyPackage('/test', 'abc123', ['packages/version', 'packages/notes']);

      expect(result).toBe(true);
      expect(execSync).toHaveBeenCalledWith(
        'git',
        ['diff-tree', '--no-commit-id', '--name-only', '-r', 'abc123'],
        expect.any(Object),
      );
    });

    it('should return false when commit only touches repo-level files', () => {
      const mockDiffOutput = Buffer.from('.github/workflows/ci.yml\nREADME.md');

      vi.mocked(execSync, { partial: true }).mockReturnValue(mockDiffOutput as any);

      const result = commitTouchesAnyPackage('/test', 'abc123', ['packages/version', 'packages/notes']);

      expect(result).toBe(false);
    });

    it('should return false when commit has no changed files', () => {
      vi.mocked(execSync, { partial: true }).mockReturnValue(Buffer.from('') as any);

      const result = commitTouchesAnyPackage('/test', 'abc123', ['packages/version']);

      expect(result).toBe(false);
    });
  });

  describe('extractRepoLevelChangelogEntries', () => {
    it('should extract only commits that do not touch any package directory', () => {
      // First call: get all commits with hash
      // Second call: check which files commit aaa111 touches
      // Third call: check which files commit bbb222 touches
      vi.mocked(execSync, { partial: true })
        .mockReturnValueOnce(
          Buffer.from(
            'aaa123|||feat(version): add feature\n---COMMIT_DELIMITER---\nbbb456|||chore(ci): update workflow',
          ),
        )
        .mockReturnValueOnce(Buffer.from('packages/version/src/feature.ts')) // aaa123 touches version package
        .mockReturnValueOnce(Buffer.from('.github/workflows/ci.yml')); // bbb456 only touches CI

      const entries = extractRepoLevelChangelogEntries('/test', 'v1.0.0..v1.1.0', ['packages/version']);

      // Should only include the CI commit
      expect(entries).toHaveLength(1);
      expect(entries[0].description).toBe('update workflow');
    });

    it('should return empty array when all commits touch packages', () => {
      vi.mocked(execSync, { partial: true })
        .mockReturnValueOnce(
          Buffer.from('abc123|||feat(version): feature\n---COMMIT_DELIMITER---\ndef456|||fix(notes): bugfix'),
        )
        .mockReturnValueOnce(Buffer.from('packages/version/src/index.ts'))
        .mockReturnValueOnce(Buffer.from('packages/notes/src/index.ts'));

      const entries = extractRepoLevelChangelogEntries('/test', 'v1.0.0..v1.1.0', [
        'packages/version',
        'packages/notes',
      ]);

      expect(entries).toHaveLength(0);
    });

    it('should include commit in all packages when it touches shared directories', () => {
      // This tests that commits touching shared directories are treated as repo-level
      vi.mocked(execSync, { partial: true })
        .mockReturnValueOnce(Buffer.from('shared123|||chore: update shared config'))
        .mockReturnValueOnce(Buffer.from('shared/config.js')); // touches shared dir, not a package

      const entries = extractRepoLevelChangelogEntries('/test', 'v1.0.0..v1.1.0', ['packages/version']);

      expect(entries).toHaveLength(1);
      expect(entries[0].description).toBe('update shared config');
    });

    it('treats commits to shared packages as repo-level and includes them in all packages', () => {
      // A commit to a shared package (like config/core) should be repo-level
      vi.mocked(execSync, { partial: true })
        .mockReturnValueOnce(Buffer.from('core123|||feat(core): add new utility'))
        .mockReturnValueOnce(Buffer.from('packages/core/src/index.ts')); // touches core package

      const entries = extractRepoLevelChangelogEntries(
        '/test',
        'v1.0.0..v1.1.0',
        ['packages/version', 'packages/core'],
        ['packages/core'],
      );

      // Should be treated as repo-level because core is in sharedPackageDirs
      expect(entries).toHaveLength(1);
      expect(entries[0].description).toBe('add new utility');
    });

    it('excludes commits to non-shared packages from repo-level', () => {
      // A commit to a regular package should NOT be repo-level
      vi.mocked(execSync, { partial: true })
        .mockReturnValueOnce(Buffer.from('version123|||feat(version): add feature'))
        .mockReturnValueOnce(Buffer.from('packages/version/src/index.ts')); // touches version package

      const entries = extractRepoLevelChangelogEntries(
        '/test',
        'v1.0.0..v1.1.0',
        ['packages/version', 'packages/core'],
        ['packages/core'],
      );

      // Should NOT be repo-level because version is not in sharedPackageDirs
      expect(entries).toHaveLength(0);
    });
  });

  describe('commitTouchesAnyPackage with shared packages', () => {
    it('should return false for shared packages when sharedPackageDirs is provided', () => {
      const mockDiffOutput = Buffer.from('packages/core/src/index.ts\npackages/core/package.json');

      vi.mocked(execSync, { partial: true }).mockReturnValue(mockDiffOutput as any);

      // When checking with sharedPackageDirs containing 'packages/core', touching core should return false
      const result = commitTouchesAnyPackage(
        '/test',
        'abc123',
        ['packages/version', 'packages/core'],
        ['packages/core'],
      );

      expect(result).toBe(false);
    });

    it('should return true for non-shared packages even when other packages are shared', () => {
      const mockDiffOutput = Buffer.from('packages/version/src/index.ts');

      vi.mocked(execSync, { partial: true }).mockReturnValue(mockDiffOutput as any);

      const result = commitTouchesAnyPackage(
        '/test',
        'abc123',
        ['packages/version', 'packages/core'],
        ['packages/core'],
      );

      expect(result).toBe(true);
    });
  });
});
