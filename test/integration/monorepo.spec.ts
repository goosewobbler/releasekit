import { aggregateToRoot, createTemplateContext, parseVersionOutput, renderMarkdown } from '@releasekit/notes';
import { describe, expect, it } from 'vitest';

describe('Integration: monorepo', () => {
  describe('Sync versioning -> all packages same version', () => {
    it('should generate aggregated changelog for monorepo', () => {
      const versionOutput = {
        dryRun: true,
        updates: [
          {
            packageName: '@test/pkg-a',
            previousVersion: '0.1.0',
            newVersion: '0.2.0',
            filePath: 'packages/pkg-a/package.json',
          },
          {
            packageName: '@test/pkg-b',
            previousVersion: '0.1.0',
            newVersion: '0.2.0',
            filePath: 'packages/pkg-b/package.json',
          },
        ],
        changelogs: [
          {
            packageName: '@test/pkg-a',
            version: '0.2.0',
            previousVersion: '0.1.0',
            revisionRange: 'v0.1.0..HEAD',
            repoUrl: null,
            entries: [{ type: 'added', description: 'Add feature in pkg-a', scope: 'pkg-a' }],
          },
          {
            packageName: '@test/pkg-b',
            version: '0.2.0',
            previousVersion: '0.1.0',
            revisionRange: 'v0.1.0..HEAD',
            repoUrl: null,
            entries: [],
          },
        ],
        tags: ['v0.2.0'],
        commitMessage: 'chore: release 0.2.0',
      };

      const input = parseVersionOutput(JSON.stringify(versionOutput));
      const contexts = input.packages.map(createTemplateContext);

      const rootContext = aggregateToRoot(contexts);
      const markdown = renderMarkdown([rootContext]);

      expect(markdown).toContain('## [0.2.0]');
      expect(markdown).toContain('@test/pkg-a');
    });
  });

  describe('Individual package changes', () => {
    it('should generate per-package changelog entries', () => {
      const versionOutput = {
        dryRun: true,
        updates: [
          {
            packageName: '@test/pkg-a',
            previousVersion: '0.1.0',
            newVersion: '0.2.0',
            filePath: 'packages/pkg-a/package.json',
          },
        ],
        changelogs: [
          {
            packageName: '@test/pkg-a',
            version: '0.2.0',
            previousVersion: '0.1.0',
            revisionRange: 'v0.1.0..HEAD',
            repoUrl: null,
            entries: [
              { type: 'added', description: 'New feature', scope: 'api' },
              { type: 'fixed', description: 'Bug fix' },
            ],
          },
        ],
        tags: ['v0.2.0'],
        commitMessage: 'chore: release 0.2.0',
      };

      const input = parseVersionOutput(JSON.stringify(versionOutput));
      const contexts = input.packages.map(createTemplateContext);
      const markdown = renderMarkdown(contexts);

      expect(markdown).toContain('## [0.2.0]');
      expect(markdown).toContain('New feature');
      expect(markdown).toContain('Bug fix');
    });
  });
});
