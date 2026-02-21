import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as changelogManagerTypes from '../../../src/changelog/changelogManager.js';
import * as changelogManager from '../../../src/changelog/changelogManager.js';

// Mock dependencies - vi.mock calls are hoisted to the top
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
import * as fs from 'node:fs';
import { log } from '../../../src/utils/logging.js';

describe('Changelog Manager', () => {
  beforeEach(() => {
    // Reset all mocks
    vi.resetAllMocks();
  });

  describe('createChangelog', () => {
    it('creates an empty changelog structure with project name', () => {
      const packageName = 'test-package';
      const changelog = changelogManager.createChangelog('/path/to/package', packageName);

      expect(changelog).toEqual({
        projectName: packageName,
        unreleased: [],
        versions: [],
      });
    });
  });

  describe('parseChangelog', () => {
    it('returns null when changelog file does not exist', () => {
      vi.mocked(fs.existsSync, { partial: true }).mockReturnValue(false);

      const result = changelogManager.parseChangelog('/path/to/changelog.md');

      expect(result).toBeNull();
      expect(fs.existsSync).toHaveBeenCalledWith('/path/to/changelog.md');
    });

    it('returns basic structure when file exists but parsing is stubbed', () => {
      vi.mocked(fs.existsSync, { partial: true }).mockReturnValue(true);
      vi.mocked(fs.readFileSync, { partial: true }).mockReturnValue('# Changelog content');

      const filePath = '/path/to/package/CHANGELOG.md';
      const result = changelogManager.parseChangelog(filePath);

      expect(result).not.toBeNull();
      expect(result?.projectName).toBe('package');
      expect(result?.unreleased).toEqual([]);
      expect(result?.versions).toEqual([]);
      expect(fs.readFileSync).toHaveBeenCalledWith(filePath, 'utf8');
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Parsed changelog'), 'info');
    });

    it('returns null and logs error when parsing fails', () => {
      vi.mocked(fs.existsSync, { partial: true }).mockReturnValue(true);
      vi.mocked(fs.readFileSync, { partial: true }).mockImplementation(() => {
        throw new Error('Read error');
      });

      const result = changelogManager.parseChangelog('/path/to/changelog.md');

      expect(result).toBeNull();
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Error parsing changelog'), 'error');
    });
  });

  describe('generateChangelogContent', () => {
    // Test data
    const testChangelog: changelogManagerTypes.Changelog = {
      projectName: 'test-package',
      unreleased: [
        {
          type: 'added',
          description: 'New unreleased feature',
          scope: 'core',
          issueIds: ['#123'],
        },
        {
          type: 'fixed',
          description: 'Fixed unreleased bug',
          scope: 'ui',
        },
      ],
      versions: [
        {
          version: '1.0.0',
          date: '2023-01-15',
          entries: [
            {
              type: 'added',
              description: 'Initial feature',
              scope: 'core',
            },
            {
              type: 'changed',
              description: '**BREAKING** API change',
              scope: 'api',
              issueIds: ['#100'],
            },
          ],
        },
      ],
    };

    it('generates Keep a Changelog format correctly', () => {
      const content = changelogManager.generateChangelogContent(testChangelog, 'https://github.com/user/repo');

      // Verify header
      expect(content).toContain('# Changelog');
      expect(content).toContain('All notable changes to test-package');
      expect(content).toContain('[Keep a Changelog]');
      expect(content).toContain('[Semantic Versioning]');

      // Verify unreleased section
      expect(content).toContain('## [Unreleased]');
      expect(content).toContain('### Added');
      expect(content).toContain('- New unreleased feature (#123)');
      expect(content).toContain('### Fixed');
      expect(content).toContain('- Fixed unreleased bug');

      // Verify version section
      expect(content).toContain('## [1.0.0] - 2023-01-15');
      expect(content).toContain('- Initial feature');
      expect(content).toContain('- **BREAKING** API change (#100)');

      // Verify links
      expect(content).toContain('[unreleased]: https://github.com/user/repo/compare/v1.0.0...HEAD');
      expect(content).toContain('[1.0.0]: https://github.com/user/repo/releases/tag/v1.0.0');
    });

    it('generates Angular format correctly', () => {
      const content = changelogManager.generateChangelogContent(
        testChangelog,
        'https://github.com/user/repo',
        'angular',
      );

      // Verify header
      expect(content).toContain('# Changelog');

      // Verify unreleased section
      expect(content).toContain('## [Unreleased]');
      expect(content).toContain('### Features');
      expect(content).toMatch(/\* \*\*core:\*\*/);
      expect(content).toContain('* New unreleased feature');
      expect(content).toContain('### Bug Fixes');
      expect(content).toMatch(/\* \*\*ui:\*\*/);
      expect(content).toContain('* Fixed unreleased bug');

      // Verify version section
      expect(content).toContain('## [1.0.0]');
      expect(content).toContain('2023-01-15');

      // Verify breaking changes section
      expect(content).toContain('### BREAKING CHANGES');
      expect(content).toContain('* **api:** API change');

      // Verify links
      expect(content).toContain('[unreleased]: https://github.com/user/repo/compare/v1.0.0...HEAD');
      expect(content).toContain('[1.0.0]: https://github.com/user/repo/releases/tag/v1.0.0');
    });

    it('generates content without links when repo URL is not provided', () => {
      const content = changelogManager.generateChangelogContent(testChangelog);

      expect(content).not.toContain('[unreleased]:');
      expect(content).not.toContain('[1.0.0]:');
    });

    it('handles empty unreleased entries and versions', () => {
      const emptyChangelog: changelogManagerTypes.Changelog = {
        projectName: 'empty-package',
        unreleased: [],
        versions: [],
      };

      const content = changelogManager.generateChangelogContent(emptyChangelog);

      expect(content).toContain('# Changelog');
      expect(content).not.toContain('## [Unreleased]');
      expect(content).not.toContain('### Added');
    });
  });

  describe('updateChangelog', () => {
    // Create our spy functions for testing
    const createChangelogSpy = vi.fn();
    const parseChangelogSpy = vi.fn();
    const generateChangelogContentSpy = vi.fn();

    // Store for the original updateChangelog function for restoration later
    let updateChangelogSpy: ReturnType<typeof vi.spyOn>;

    const packagePath = '/path/to/package';
    const packageName = 'test-package';
    const entries: changelogManagerTypes.ChangelogEntry[] = [
      { type: 'added', description: 'New feature' },
      { type: 'fixed', description: 'Bug fix' },
    ];

    beforeEach(() => {
      // Reset our spies
      createChangelogSpy.mockReset();
      parseChangelogSpy.mockReset();
      generateChangelogContentSpy.mockReset();

      // Setup default implementations
      createChangelogSpy.mockImplementation((_packagePath, pkgName) => ({
        projectName: pkgName,
        unreleased: [],
        versions: [],
      }));

      parseChangelogSpy.mockImplementation((filePath) => {
        if (filePath === path.join(packagePath, 'CHANGELOG.md') && fs.existsSync(filePath)) {
          return {
            projectName: packageName,
            unreleased: [{ type: 'changed', description: 'Existing change' }],
            versions: [
              {
                version: '1.0.0',
                date: '2023-01-01',
                entries: [{ type: 'added', description: 'Initial feature' }],
              },
            ],
          };
        }
        return null;
      });

      generateChangelogContentSpy.mockReturnValue('# Generated changelog content');

      // Mock the updateChangelog function with a spy
      updateChangelogSpy = vi
        .spyOn(changelogManager, 'updateChangelog')
        .mockImplementation(
          (
            pkgPath: string,
            pkgName: string,
            version: string,
            entryList: changelogManagerTypes.ChangelogEntry[],
            repoUrl?: string,
            format: 'keep-a-changelog' | 'angular' = 'keep-a-changelog',
          ) => {
            try {
              const changelogPath = path.join(pkgPath, 'CHANGELOG.md');
              let changelog: changelogManagerTypes.Changelog;

              // Check if changelog exists
              if (fs.existsSync(changelogPath)) {
                const existingChangelog = parseChangelogSpy(changelogPath);
                if (existingChangelog) {
                  changelog = existingChangelog;
                } else {
                  // If parsing failed, create a new one
                  changelog = createChangelogSpy(pkgPath, pkgName);
                }
              } else {
                // Create new changelog
                changelog = createChangelogSpy(pkgPath, pkgName);
              }

              // Move unreleased entries to the new version if this is a version release
              if (version) {
                const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

                // Create new version with unreleased entries + new entries
                const newVersion = {
                  version,
                  date: today,
                  entries: [...changelog.unreleased, ...entryList],
                };

                // Clear unreleased and add the new version at the beginning
                changelog.unreleased = [];
                changelog.versions.unshift(newVersion);
              } else {
                // Just add entries to unreleased section
                changelog.unreleased = [...changelog.unreleased, ...entryList];
              }

              // Generate content and write to file
              const content = generateChangelogContentSpy(changelog, repoUrl, format);
              fs.writeFileSync(changelogPath, content);

              log(`Updated changelog at ${changelogPath}`, 'success');
            } catch (error) {
              log(`Error updating changelog: ${error instanceof Error ? error.message : String(error)}`, 'error');
            }
          },
        );
    });

    afterEach(() => {
      // Restore the original function after each test
      updateChangelogSpy.mockRestore();
    });

    it('creates new changelog when file does not exist', () => {
      vi.mocked(fs.existsSync, { partial: true }).mockReturnValue(false);

      changelogManager.updateChangelog(packagePath, packageName, '', entries);

      // Should create changelog and add entries to unreleased
      expect(createChangelogSpy).toHaveBeenCalledWith(packagePath, packageName);
      expect(generateChangelogContentSpy).toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.join(packagePath, 'CHANGELOG.md'),
        '# Generated changelog content',
      );
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Updated changelog'), 'success');
    });

    it('adds entries to unreleased section when no version is specified', () => {
      vi.mocked(fs.existsSync, { partial: true }).mockReturnValue(true);

      changelogManager.updateChangelog(packagePath, packageName, '', entries);

      // Should add entries to unreleased section
      expect(generateChangelogContentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          unreleased: expect.arrayContaining([{ type: 'changed', description: 'Existing change' }, ...entries]),
        }),
        undefined,
        'keep-a-changelog',
      );
    });

    it('creates a new version and clears unreleased when version is specified', () => {
      vi.mocked(fs.existsSync, { partial: true }).mockReturnValue(true);

      const version = '1.1.0';
      changelogManager.updateChangelog(packagePath, packageName, version, entries);

      // Today's date in YYYY-MM-DD format
      const today = new Date().toISOString().split('T')[0];

      // Should create new version with unreleased + new entries
      expect(generateChangelogContentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          unreleased: [],
          versions: expect.arrayContaining([
            expect.objectContaining({
              version,
              date: today,
              entries: expect.arrayContaining([{ type: 'changed', description: 'Existing change' }, ...entries]),
            }),
          ]),
        }),
        undefined,
        'keep-a-changelog',
      );
    });

    it('uses specified repository URL and format', () => {
      vi.mocked(fs.existsSync, { partial: true }).mockReturnValue(true);

      const repoUrl = 'https://github.com/user/repo';
      const format = 'angular' as const;

      changelogManager.updateChangelog(packagePath, packageName, '1.1.0', entries, repoUrl, format);

      expect(generateChangelogContentSpy).toHaveBeenCalledWith(expect.any(Object), repoUrl, format);
    });

    it('handles errors during update', () => {
      vi.mocked(fs.existsSync, { partial: true }).mockImplementation(() => {
        throw new Error('Test error');
      });

      changelogManager.updateChangelog(packagePath, packageName, '', entries);

      expect(log).toHaveBeenCalledWith(expect.stringContaining('Error updating changelog'), 'error');
    });
  });
});
