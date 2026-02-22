import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extractChangelogEntriesFromCommits } from '../../../src/changelog/commitParser.js';

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

  it('extracts changelog entries from conventional commits', () => {
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

  it('extracts breaking changes from commit messages', () => {
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

  it('extracts issue IDs from commit messages', () => {
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

  it('handles non-conventional commits', () => {
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

  it('handles errors when extracting commits', () => {
    // Mock execSync to throw an error
    vi.mocked(execSync, { partial: true }).mockImplementation(() => {
      throw new Error('Git command failed');
    });

    const entries = extractChangelogEntriesFromCommits('/test', 'v1.0.0..v1.1.0');

    // Should return empty array on error
    expect(entries).toEqual([]);
  });
});
