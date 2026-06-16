import { createTemplateContext, parseVersionOutput, renderMarkdown } from '@releasekit/notes';
import { describe, expect, it } from 'vitest';

describe('Integration: single package', () => {
  describe('Feature commit -> minor version bump', () => {
    it('should generate correct changelog entry', () => {
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
        commitMessage: 'chore: release test-single-package v0.2.0',
      };

      const input = parseVersionOutput(JSON.stringify(versionOutput));
      const contexts = input.packages.map(createTemplateContext);
      const markdown = renderMarkdown(contexts);

      expect(markdown).toContain('## [0.2.0]');
      expect(markdown).toContain('### Added');
      expect(markdown).toContain('Add awesome feature');
    });
  });

  describe('Fix commit -> patch version bump', () => {
    it('should generate correct changelog entry', () => {
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
        commitMessage: 'chore: release test-single-package v0.1.1',
      };

      const input = parseVersionOutput(JSON.stringify(versionOutput));
      const contexts = input.packages.map(createTemplateContext);
      const markdown = renderMarkdown(contexts);

      expect(markdown).toContain('## [0.1.1]');
      expect(markdown).toContain('### Fixed');
      expect(markdown).toContain('Resolve bug in parser');
    });
  });

  describe('Breaking change -> major version bump', () => {
    it('should generate correct changelog entry with breaking marker', () => {
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
        commitMessage: 'chore: release test-single-package v1.0.0',
      };

      const input = parseVersionOutput(JSON.stringify(versionOutput));
      const contexts = input.packages.map(createTemplateContext);
      const markdown = renderMarkdown(contexts);

      expect(markdown).toContain('## [1.0.0]');
      expect(markdown).toContain('**BREAKING**');
    });
  });

  describe('Scoped feature -> changelog with scope', () => {
    it('should include scope in changelog entry', () => {
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
        commitMessage: 'chore: release test-single-package v0.2.0',
      };

      const input = parseVersionOutput(JSON.stringify(versionOutput));
      const contexts = input.packages.map(createTemplateContext);
      const markdown = renderMarkdown(contexts);

      expect(markdown).toContain('**api**:');
      expect(markdown).toContain('Add streaming support');
    });
  });

  describe('First release -> intro line, no compare link', () => {
    it('should derive isFirstRelease from a null previousVersion and render the intro', () => {
      const versionOutput = {
        dryRun: true,
        updates: [
          {
            packageName: 'test-single-package',
            previousVersion: null,
            newVersion: '0.1.0',
            filePath: 'package.json',
          },
        ],
        changelogs: [
          {
            packageName: 'test-single-package',
            version: '0.1.0',
            previousVersion: null,
            revisionRange: 'HEAD',
            repoUrl: null,
            entries: [{ type: 'added', description: 'Initial public API' }],
          },
        ],
        tags: ['v0.1.0'],
        commitMessage: 'chore: release test-single-package v0.1.0',
      };

      const input = parseVersionOutput(JSON.stringify(versionOutput));
      const contexts = input.packages.map(createTemplateContext);
      // The version→notes contract: a null previousVersion is the first-release signal.
      expect(contexts[0]?.isFirstRelease).toBe(true);

      const markdown = renderMarkdown(contexts);

      // Unbracketed header (no prior version to link), the factual intro line, and the entries.
      expect(markdown).toContain('## 0.1.0');
      expect(markdown).not.toContain('## [0.1.0]');
      expect(markdown).toContain('_First release of test-single-package._');
      expect(markdown).toContain('Initial public API');
      // Markers live only on the GitHub release body surface, never in the changelog document.
      expect(markdown).not.toContain('<!-- releasekit-notes');
    });
  });
});
