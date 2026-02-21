import { describe, expect, it } from 'vitest';
import type { ChangelogEntry } from '../../../src/changelog/changelogManager.js';
import { formatChangelogEntries } from '../../../src/changelog/formatters.js';

describe('Changelog Formatters', () => {
  // Sample entries for testing
  const testEntries: ChangelogEntry[] = [
    {
      type: 'added',
      description: 'New feature',
      scope: 'core',
      originalType: 'feat',
    },
    {
      type: 'fixed',
      description: 'Bug fix',
      scope: 'ui',
      originalType: 'fix',
    },
    {
      type: 'changed',
      description: 'Refactored code',
      scope: 'api',
      originalType: 'refactor',
    },
    {
      type: 'changed',
      description: 'Removed feature',
      scope: 'core',
      originalType: 'chore',
    },
    {
      type: 'fixed',
      description: '**BREAKING** API change',
      scope: 'api',
      originalType: 'fix',
    },
  ];

  describe('Keep a Changelog Format', () => {
    it('formats entries in Keep a Changelog format', () => {
      const version = '1.0.0';
      const date = '2023-01-15';

      const formattedContent = formatChangelogEntries('keep-a-changelog', version, date, testEntries);

      // Verify version and date
      expect(formattedContent).toContain(`## [${version}] - ${date}`);

      // Verify sections
      expect(formattedContent).toContain('### Added');
      expect(formattedContent).toContain('### Changed');
      expect(formattedContent).toContain('### Fixed');
      // Don't check for "Removed" section since we've updated the entry type to "changed"

      // Verify entries with scopes
      expect(formattedContent).toContain('- **core**: New feature');
      expect(formattedContent).toContain('- **ui**: Bug fix');
      expect(formattedContent).toContain('- **api**: Refactored code');
      expect(formattedContent).toContain('- **core**: Removed feature');

      // Verify breaking change formatting (single **BREAKING** prefix with scope)
      expect(formattedContent).toContain('- **BREAKING** **api**: API change');
    });

    it('includes repository links when URL is provided', () => {
      const version = '1.0.0';
      const date = '2023-01-15';
      const repoUrl = 'https://github.com/user/repo';

      const formattedContent = formatChangelogEntries(
        'keep-a-changelog',
        version,
        date,
        testEntries,
        undefined,
        repoUrl,
      );

      // Verify link
      expect(formattedContent).toContain(`[${version}]: ${repoUrl}/compare/v${version}...HEAD`);
    });
  });

  describe('Angular Changelog Format', () => {
    it('formats entries in Angular format', () => {
      const version = '1.0.0';
      const date = '2023-01-15';
      const packageName = 'test-package';

      const formattedContent = formatChangelogEntries('angular', version, date, testEntries, packageName);

      // Verify version, date and package name
      expect(formattedContent).toContain(`## [${version}]`);
      expect(formattedContent).toContain(`(${packageName})`);
      expect(formattedContent).toContain(`(${date})`);

      // Verify sections
      expect(formattedContent).toContain('### Features');
      expect(formattedContent).toContain('### Bug Fixes');
      expect(formattedContent).toContain('### BREAKING CHANGES');

      // Verify scope formatting
      expect(formattedContent).toMatch(/\* \*\*core:\*\*/);
      expect(formattedContent).toMatch(/\* \*\*ui:\*\*/);
      expect(formattedContent).toMatch(/\* \*\*api:\*\*/);
    });

    it('formats entries without package name', () => {
      const version = '1.0.0';
      const date = '2023-01-15';

      const formattedContent = formatChangelogEntries('angular', version, date, testEntries);

      // Verify version and date without package name
      expect(formattedContent).toContain(`## [${version}]`);
      expect(formattedContent).toContain(`(${date})`);
    });

    it('handles entries without scope', () => {
      const entriesWithoutScope: ChangelogEntry[] = [
        {
          type: 'added',
          description: 'New feature without scope',
          originalType: 'feat',
        },
        {
          type: 'fixed',
          description: 'Bug fix without scope',
          originalType: 'fix',
        },
      ];

      const formattedContent = formatChangelogEntries('angular', '1.0.0', '2023-01-15', entriesWithoutScope);

      // Entries should not have scope indicators
      expect(formattedContent).toContain('* New feature without scope');
      expect(formattedContent).toContain('* Bug fix without scope');
    });
  });
});
