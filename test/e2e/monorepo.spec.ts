import { aggregateToRoot, createTemplateContext, parsePackageVersioner, renderMarkdown } from '@releasekit/notes';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupTempDir, copyFixtureToTemp, createConventionalCommit, initGitRepo } from './utils/e2e-helpers.js';

describe('E2E: monorepo', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = copyFixtureToTemp('monorepo');
    initGitRepo(tempDir);
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe('Sync versioning -> all packages same version', () => {
    it('generates aggregated changelog for monorepo', () => {
      createConventionalCommit(tempDir, 'feat', 'add feature in pkg-a', 'pkg-a');

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
        commitMessage: 'chore(release): 0.2.0',
      };

      const input = parsePackageVersioner(JSON.stringify(versionOutput));
      const contexts = input.packages.map(createTemplateContext);

      const rootContext = aggregateToRoot(contexts);
      const markdown = renderMarkdown([rootContext]);

      expect(markdown).toContain('## [0.2.0]');
      expect(markdown).toContain('@test/pkg-a');
    });
  });

  describe('Individual package changes', () => {
    it('generates per-package changelog entries', () => {
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
        commitMessage: 'chore(release): 0.2.0',
      };

      const input = parsePackageVersioner(JSON.stringify(versionOutput));
      const contexts = input.packages.map(createTemplateContext);
      const markdown = renderMarkdown(contexts);

      expect(markdown).toContain('## [0.2.0]');
      expect(markdown).toContain('New feature');
      expect(markdown).toContain('Bug fix');
    });
  });
});
