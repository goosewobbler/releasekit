import { createTemplateContext, parseVersionOutput, renderMarkdown } from '@releasekit/notes';
import { describe, expect, it } from 'vitest';

describe('Integration: scoped release (wdio-style)', () => {
  describe('scope:spy targeting @test/native-spy only', () => {
    it('generates changelog only for targeted package', () => {
      const versionOutput = {
        dryRun: true,
        updates: [
          {
            packageName: '@test/native-spy',
            previousVersion: '1.0.0',
            newVersion: '1.0.1',
            filePath: 'packages/native-spy/package.json',
          },
        ],
        changelogs: [
          {
            packageName: '@test/native-spy',
            version: '1.0.1',
            previousVersion: '1.0.0',
            revisionRange: '@test/native-spy@v1.0.0..HEAD',
            repoUrl: null,
            entries: [{ type: 'fixed', description: 'Reset spy call history on test cleanup', scope: 'spy' }],
          },
        ],
        tags: ['@test/native-spy@v1.0.1'],
        commitMessage: 'chore: release @test/native-spy v1.0.1',
      };

      const input = parseVersionOutput(JSON.stringify(versionOutput));
      const contexts = input.packages.map(createTemplateContext);
      const markdown = renderMarkdown(contexts);

      expect(markdown).toContain('## [1.0.1]');
      expect(markdown).toContain('### Fixed');
      expect(markdown).toContain('Reset spy call history');
      expect(markdown).not.toContain('@test/electron-service');
      expect(markdown).not.toContain('@test/tauri-service');
    });
  });

  describe('scope:electron targeting @test/electron-* (multiple packages)', () => {
    it('generates per-package changelog entries for electron scope', () => {
      const versionOutput = {
        dryRun: true,
        updates: [
          {
            packageName: '@test/electron-service',
            previousVersion: '2.0.0',
            newVersion: '2.0.1',
            filePath: 'packages/electron-service/package.json',
          },
          {
            packageName: '@test/electron-cdp-bridge',
            previousVersion: '2.0.0',
            newVersion: '2.0.1',
            filePath: 'packages/electron-cdp-bridge/package.json',
          },
        ],
        changelogs: [
          {
            packageName: '@test/electron-service',
            version: '2.0.1',
            previousVersion: '2.0.0',
            revisionRange: '@test/electron-service@v2.0.0..HEAD',
            repoUrl: null,
            entries: [{ type: 'fixed', description: 'Fix app launch detection on macOS', scope: 'launcher' }],
          },
          {
            packageName: '@test/electron-cdp-bridge',
            version: '2.0.1',
            previousVersion: '2.0.0',
            revisionRange: '@test/electron-cdp-bridge@v2.0.0..HEAD',
            repoUrl: null,
            entries: [],
          },
        ],
        tags: ['@test/electron-service@v2.0.1', '@test/electron-cdp-bridge@v2.0.1'],
        commitMessage: 'chore: release @test/electron-service, @test/electron-cdp-bridge v2.0.1',
      };

      const input = parseVersionOutput(JSON.stringify(versionOutput));
      const contexts = input.packages.map(createTemplateContext);
      const markdown = renderMarkdown(contexts);

      expect(markdown).toContain('## [2.0.1]');
      expect(markdown).toContain('Fix app launch detection on macOS');
      expect(markdown).not.toContain('@test/native-spy');
      expect(markdown).not.toContain('@test/tauri-service');
    });
  });

  describe('prerelease update for tauri-service (3.x prerelease range)', () => {
    it('generates changelog for prerelease version increment', () => {
      const versionOutput = {
        dryRun: true,
        updates: [
          {
            packageName: '@test/tauri-service',
            previousVersion: '3.0.0-next.0',
            newVersion: '3.0.0-next.1',
            filePath: 'packages/tauri-service/package.json',
          },
        ],
        changelogs: [
          {
            packageName: '@test/tauri-service',
            version: '3.0.0-next.1',
            previousVersion: '3.0.0-next.0',
            revisionRange: '@test/tauri-service@v3.0.0-next.0..HEAD',
            repoUrl: null,
            entries: [{ type: 'added', description: 'Support Tauri v2 window management API' }],
          },
        ],
        tags: ['@test/tauri-service@v3.0.0-next.1'],
        commitMessage: 'chore: release @test/tauri-service v3.0.0-next.1',
      };

      const input = parseVersionOutput(JSON.stringify(versionOutput));
      const contexts = input.packages.map(createTemplateContext);
      const markdown = renderMarkdown(contexts);

      expect(markdown).toContain('3.0.0-next.1');
      expect(markdown).toContain('Support Tauri v2 window management API');
    });
  });

  describe('stable graduation for tauri-service', () => {
    it('generates changelog for prerelease-to-stable graduation', () => {
      const versionOutput = {
        dryRun: true,
        updates: [
          {
            packageName: '@test/tauri-service',
            previousVersion: '3.0.0-next.0',
            newVersion: '3.0.0',
            filePath: 'packages/tauri-service/package.json',
          },
        ],
        changelogs: [
          {
            packageName: '@test/tauri-service',
            version: '3.0.0',
            previousVersion: '3.0.0-next.0',
            revisionRange: '@test/tauri-service@v3.0.0-next.0..HEAD',
            repoUrl: null,
            entries: [{ type: 'added', description: 'Stable release of Tauri v2 integration' }],
          },
        ],
        tags: ['@test/tauri-service@v3.0.0'],
        commitMessage: 'chore: release @test/tauri-service v3.0.0',
      };

      const input = parseVersionOutput(JSON.stringify(versionOutput));
      const contexts = input.packages.map(createTemplateContext);
      const markdown = renderMarkdown(contexts);

      expect(markdown).toContain('## [3.0.0]');
      expect(markdown).toContain('Stable release of Tauri v2 integration');
    });
  });
});
