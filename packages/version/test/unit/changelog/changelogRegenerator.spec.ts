import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RegenerateOptions } from '../../../src/changelog/changelogRegenerator.js';
import { regenerateChangelog, writeChangelog } from '../../../src/changelog/changelogRegenerator.js';

// Mock dependencies - vi.mock calls are hoisted to the top
// We need to mock fs as it's imported by default in the module
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('node:fs', () => {
  const mockFs = {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
  return {
    ...mockFs,
    default: mockFs,
  };
});

vi.mock('../../../src/utils/logging.js', () => ({
  log: vi.fn(),
}));

// Import mocked modules
import { execSync } from 'node:child_process';
import fs from 'node:fs';
// Import the modules to spy on
import * as commitParser from '../../../src/changelog/commitParser.js';
import * as formatters from '../../../src/changelog/formatters.js';
import * as templates from '../../../src/changelog/templates.js';
import { log } from '../../../src/utils/logging.js';

describe('Regenerate Changelog Feature', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    vi.resetAllMocks();

    // Set up spies for the imported modules
    vi.spyOn(commitParser, 'extractChangelogEntriesFromCommits').mockReturnValue([
      { type: 'added', description: 'New feature' },
      { type: 'fixed', description: 'Fixed bug' },
    ]);

    // Mock with a simpler implementation that doesn't need the unused parameters
    vi.spyOn(formatters, 'formatChangelogEntries').mockImplementation((_format, version, date) => {
      // Ignore other parameters for simplicity in tests
      return `## [${version}] - ${date}\n\n### Added\n\n- New feature\n\n### Fixed\n\n- Fixed bug`;
    });

    vi.spyOn(templates, 'getDefaultTemplate').mockImplementation((format) =>
      format === 'keep-a-changelog' ? '# Changelog\n\nAll notable changes...\n\n' : '# Changelog\n\n',
    );

    // Set up common mock responses
    vi.mocked(fs.existsSync, { partial: true }).mockReturnValue(true);
    vi.mocked(fs.readFileSync, { partial: true }).mockReturnValue(
      JSON.stringify({
        name: 'test-package',
        version: '0.3.0',
        repository: 'https://github.com/user/repo',
      }),
    );

    vi.mocked(execSync, { partial: true }).mockImplementation((cmd) => {
      if (typeof cmd !== 'string') return '';

      if (cmd.includes('git tag --list')) {
        return 'v0.1.0\nv0.2.0\nv0.3.0';
      }
      if (cmd.includes('git log -1 --format=%ad')) {
        return '2023-01-15';
      }
      if (cmd.includes('grep -E')) {
        return 'v0.1.0';
      }
      return '';
    });
  });

  it('generates a complete changelog based on git history', async () => {
    // Create CLI options for regeneration
    const options: RegenerateOptions = {
      format: 'keep-a-changelog' as const,
      output: 'CHANGELOG.md',
      dryRun: false,
      projectDir: '/test',
    };

    // Generate the changelog content
    const content = await regenerateChangelog(options);

    // Verify template was used
    expect(templates.getDefaultTemplate).toHaveBeenCalledWith('keep-a-changelog');

    // Verify extractChangelogEntriesFromCommits was called for each tag
    expect(commitParser.extractChangelogEntriesFromCommits).toHaveBeenCalledTimes(3);

    // Verify formatChangelogEntries was called for each tag
    expect(formatters.formatChangelogEntries).toHaveBeenCalledTimes(3);

    // Basic verification of content
    expect(content).toContain('# Changelog');
    expect(content).toContain('## [0.3.0]');
    expect(content).toContain('## [0.2.0]');
    expect(content).toContain('## [0.1.0]');
  });

  it('supports angular format', async () => {
    const options: RegenerateOptions = {
      format: 'angular',
      output: 'CHANGELOG.md',
      dryRun: false,
      projectDir: '/test',
    };

    await regenerateChangelog(options);

    // Verify template was used
    expect(templates.getDefaultTemplate).toHaveBeenCalledWith('angular');

    // Verify formatChangelogEntries was called with angular format
    expect(formatters.formatChangelogEntries).toHaveBeenCalledWith(
      'angular',
      expect.any(String),
      expect.any(String),
      expect.any(Array),
      expect.any(String),
      expect.any(String),
    );
  });

  it('uses since parameter to limit tags', async () => {
    // Mock git tag list and date commands to simulate tag history
    vi.mocked(execSync, { partial: true }).mockImplementation((cmd) => {
      if (typeof cmd !== 'string') return '';

      if (cmd.includes('git tag --list')) {
        // Return a full chronological list of tags including the since tag
        return 'v0.1.0\nv0.2.0\nv0.3.0';
      }

      if (cmd.includes('git log -1 --format=%ad')) {
        return '2023-01-15';
      }
      return '';
    });

    const options = {
      cwd: '/test/workspace',
      since: 'v0.2.0',
      versionPrefix: 'v',
      dryRun: true,
      format: 'keep-a-changelog' as const,
      repoUrl: undefined,
      changelogPath: '/test/workspace/CHANGELOG.md',
      output: 'CHANGELOG.md',
      projectDir: '/test/workspace',
    };

    await expect(regenerateChangelog(options)).resolves.not.toThrow();
  });

  it('extracts repository URL from package.json', async () => {
    const options: RegenerateOptions = {
      format: 'keep-a-changelog' as const,
      output: 'CHANGELOG.md',
      dryRun: false,
      projectDir: '/test',
    };

    // Mock package.json with repository URL
    vi.mocked(fs.readFileSync, { partial: true }).mockReturnValue(
      JSON.stringify({
        name: 'test-package',
        repository: {
          url: 'git+https://github.com/user/repo.git',
        },
      }),
    );

    await regenerateChangelog(options);

    // Verify repository URL was cleaned up and passed to formatChangelogEntries
    expect(formatters.formatChangelogEntries).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(Array),
      expect.any(String),
      'https://github.com/user/repo',
    );
  });

  it('throws error when no tags are found', async () => {
    const options: RegenerateOptions = {
      format: 'keep-a-changelog' as const,
      output: 'CHANGELOG.md',
      dryRun: false,
      projectDir: '/test',
    };

    // Mock empty tag list
    vi.mocked(execSync, { partial: true }).mockImplementation((cmd) => {
      if (typeof cmd !== 'string') return '';

      if (cmd.includes('git tag --list')) {
        return '';
      }
      return '';
    });

    await expect(regenerateChangelog(options)).rejects.toThrow('No version tags found');
  });

  it('handles missing package.json', async () => {
    const options: RegenerateOptions = {
      format: 'keep-a-changelog' as const,
      output: 'CHANGELOG.md',
      dryRun: false,
      projectDir: '/test',
    };

    // Mock package.json missing
    vi.mocked(fs.existsSync, { partial: true }).mockReturnValue(false);

    // Set the getDefaultTemplate spy to return a specific value
    vi.spyOn(templates, 'getDefaultTemplate').mockReturnValue('# Changelog\n\n');

    const content = await regenerateChangelog(options);

    // Should still generate content without package info
    expect(content).toContain('# Changelog');
  });

  it('adds placeholder entry when no commits found for tag', async () => {
    const options: RegenerateOptions = {
      format: 'keep-a-changelog' as const,
      output: 'CHANGELOG.md',
      dryRun: false,
      projectDir: '/test',
    };

    // Mock no commits for a tag by setting up a one-time return value
    const extractSpy = vi.spyOn(commitParser, 'extractChangelogEntriesFromCommits');
    extractSpy.mockReturnValueOnce([]);

    await regenerateChangelog(options);

    // Should call formatChangelogEntries with placeholder entry
    expect(formatters.formatChangelogEntries).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.arrayContaining([
        expect.objectContaining({
          type: 'changed',
          description: expect.stringMatching(/Release version/),
        }),
      ]),
      expect.any(String),
      expect.any(String),
    );
  });

  it('can write the changelog to a file', async () => {
    const content = '# Test Changelog';
    const outputPath = join('/test', 'CHANGELOG.md');

    await writeChangelog(content, outputPath, false);

    // Verify that writeFileSync was called
    expect(fs.writeFileSync).toHaveBeenCalledWith(outputPath, content, 'utf8');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('successfully written'), 'success');
  });

  it('does not write to file in dry run mode', async () => {
    const content = '# Test Changelog';
    const outputPath = join('/test', 'CHANGELOG.md');

    await writeChangelog(content, outputPath, true);

    // Verify writeFileSync was not called
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('--- Changelog Preview ---', 'info');
  });

  it('handles writeFileSync error', async () => {
    const content = '# Test Changelog';
    const outputPath = join('/test', 'CHANGELOG.md');

    // Mock writeFileSync to throw error
    vi.mocked(fs.writeFileSync, { partial: true }).mockImplementation(() => {
      throw new Error('Write error');
    });

    await expect(writeChangelog(content, outputPath, false)).rejects.toThrow('Failed to write changelog');
  });
});
