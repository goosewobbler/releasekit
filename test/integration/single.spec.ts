import { createTemplateContext, parsePackageVersioner, renderMarkdown } from '@releasekit/notes';
import { describe, expect, it } from 'vitest';

describe('Integration: single package', () => {
  describe('Feature commit -> minor version bump', () => {
    it('generates correct changelog entry', () => {
      const versionOutput = {
        dryRun: true,
        updates: [
          {
            packageName: 'test-single-package',
            previousVersion: '0.1.0',
            newVersion: '0.2.0',
            filePath: 'package.json',
          },
        ],
        changelogs: [
          {
            packageName: 'test-single-package',
            version: '0.2.0',
            previousVersion: '0.1.0',
            revisionRange: 'v0.1.0..HEAD',
            repoUrl: null,
            entries: [{ type: 'added', description: 'Add awesome feature' }],
          },
        ],
        tags: ['v0.2.0'],
        commitMessage: 'chore(release): 0.2.0',
      };

      const input = parsePackageVersioner(JSON.stringify(versionOutput));
      const contexts = input.packages.map(createTemplateContext);
      const markdown = renderMarkdown(contexts);

      expect(markdown).toContain('## [0.2.0]');
      expect(markdown).toContain('### Added');
      expect(markdown).toContain('Add awesome feature');
    });
  });

  describe('Fix commit -> patch version bump', () => {
    it('generates correct changelog entry', () => {
      const versionOutput = {
        dryRun: true,
        updates: [
          {
            packageName: 'test-single-package',
            previousVersion: '0.1.0',
            newVersion: '0.1.1',
            filePath: 'package.json',
          },
        ],
        changelogs: [
          {
            packageName: 'test-single-package',
            version: '0.1.1',
            previousVersion: '0.1.0',
            revisionRange: 'v0.1.0..HEAD',
            repoUrl: null,
            entries: [{ type: 'fixed', description: 'Resolve bug in parser' }],
          },
        ],
        tags: ['v0.1.1'],
        commitMessage: 'chore(release): 0.1.1',
      };

      const input = parsePackageVersioner(JSON.stringify(versionOutput));
      const contexts = input.packages.map(createTemplateContext);
      const markdown = renderMarkdown(contexts);

      expect(markdown).toContain('## [0.1.1]');
      expect(markdown).toContain('### Fixed');
      expect(markdown).toContain('Resolve bug in parser');
    });
  });

  describe('Breaking change -> major version bump', () => {
    it('generates correct changelog entry with breaking marker', () => {
      const versionOutput = {
        dryRun: true,
        updates: [
          {
            packageName: 'test-single-package',
            previousVersion: '0.1.0',
            newVersion: '1.0.0',
            filePath: 'package.json',
          },
        ],
        changelogs: [
          {
            packageName: 'test-single-package',
            version: '1.0.0',
            previousVersion: '0.1.0',
            revisionRange: 'v0.1.0..HEAD',
            repoUrl: null,
            entries: [{ type: 'added', description: 'Redesign API', breaking: true }],
          },
        ],
        tags: ['v1.0.0'],
        commitMessage: 'chore(release): 1.0.0',
      };

      const input = parsePackageVersioner(JSON.stringify(versionOutput));
      const contexts = input.packages.map(createTemplateContext);
      const markdown = renderMarkdown(contexts);

      expect(markdown).toContain('## [1.0.0]');
      expect(markdown).toContain('**BREAKING**');
    });
  });

  describe('Scoped feature -> changelog with scope', () => {
    it('includes scope in changelog entry', () => {
      const versionOutput = {
        dryRun: true,
        updates: [
          {
            packageName: 'test-single-package',
            previousVersion: '0.1.0',
            newVersion: '0.2.0',
            filePath: 'package.json',
          },
        ],
        changelogs: [
          {
            packageName: 'test-single-package',
            version: '0.2.0',
            previousVersion: '0.1.0',
            revisionRange: 'v0.1.0..HEAD',
            repoUrl: null,
            entries: [{ type: 'added', description: 'Add streaming support', scope: 'api' }],
          },
        ],
        tags: ['v0.2.0'],
        commitMessage: 'chore(release): 0.2.0',
      };

      const input = parsePackageVersioner(JSON.stringify(versionOutput));
      const contexts = input.packages.map(createTemplateContext);
      const markdown = renderMarkdown(contexts);

      expect(markdown).toContain('**api**:');
      expect(markdown).toContain('Add streaming support');
    });
  });
});
