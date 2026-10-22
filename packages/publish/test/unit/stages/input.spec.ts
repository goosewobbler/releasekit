import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
  VersionChangelogEntry,
  VersionOutput,
  VersionPackageChangelog,
  VersionPackageUpdate,
} from '@releasekit/core';
import { afterEach, describe, expect, it } from 'vitest';
import { PublishErrorCode } from '../../../src/errors/index.js';
import { parseInput } from '../../../src/stages/input.js';

describe('input stage', () => {
  const tmpDirs: string[] = [];

  function createTmpDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'releasekit-input-test-'));
    tmpDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  function writeInput(input: unknown): string {
    const filePath = path.join(createTmpDir(), 'version-output.json');
    fs.writeFileSync(filePath, JSON.stringify(input));
    return filePath;
  }

  describe('parseInput from file', () => {
    it('should parse valid version output from file', async () => {
      const fixturePath = path.resolve(__dirname, '../../fixtures/version-output.json');
      const result = await parseInput(fixturePath);

      expect(result.dryRun).toBe(false);
      expect(result.updates).toHaveLength(2);
      expect(result.updates[0]?.packageName).toBe('@releasekit/version');
      expect(result.tags).toHaveLength(2);
      expect(result.commitMessage).toContain('release');
    });

    it('should parse pre-release version output', async () => {
      const fixturePath = path.resolve(__dirname, '../../fixtures/version-output-prerelease.json');
      const result = await parseInput(fixturePath);

      expect(result.updates[0]?.newVersion).toBe('0.2.0-next.1');
    });

    it('should parse cargo version output', async () => {
      const fixturePath = path.resolve(__dirname, '../../fixtures/version-output-cargo.json');
      const result = await parseInput(fixturePath);

      expect(result.updates).toHaveLength(2);
      expect(result.updates[1]?.filePath).toContain('Cargo.toml');
    });

    it('should throw on non-existent file', async () => {
      await expect(parseInput('/tmp/nonexistent-file.json')).rejects.toHaveProperty(
        'code',
        PublishErrorCode.INPUT_PARSE_ERROR,
      );
    });

    it('should throw on invalid JSON file', async () => {
      const dir = createTmpDir();
      const filePath = path.join(dir, 'bad.json');
      fs.writeFileSync(filePath, 'not json');

      await expect(parseInput(filePath)).rejects.toHaveProperty('code', PublishErrorCode.INPUT_PARSE_ERROR);
    });

    it('should throw on invalid schema', async () => {
      const dir = createTmpDir();
      const filePath = path.join(dir, 'invalid.json');
      fs.writeFileSync(filePath, JSON.stringify({ foo: 'bar' }));

      await expect(parseInput(filePath)).rejects.toHaveProperty('code', PublishErrorCode.INPUT_VALIDATION_ERROR);
    });

    it('should accept empty updates array without error', async () => {
      const dir = createTmpDir();
      const filePath = path.join(dir, 'empty-updates.json');
      fs.writeFileSync(filePath, JSON.stringify({ dryRun: false, updates: [], changelogs: [], tags: [] }));

      const result = await parseInput(filePath);

      expect(result.updates).toHaveLength(0);
    });

    it('should keep per-package tags and baseline tags', async () => {
      const result = await parseInput(
        writeInput({
          dryRun: false,
          updates: [
            { packageName: 'pkg-a', newVersion: '1.1.0', filePath: 'packages/a/package.json', tag: 'pkg-a@v1.1.0' },
            { packageName: 'pkg-b', newVersion: '2.0.0', filePath: 'packages/b/package.json', tag: 'pkg-b@v2.0.0' },
          ],
          changelogs: [],
          tags: ['pkg-a@v1.1.0', 'pkg-b@v2.0.0'],
          baselineTags: ['release/pkg-a@v1.1.0', 'release/pkg-b@v2.0.0'],
        }),
      );

      expect(result.updates.map((u) => u.tag)).toEqual(['pkg-a@v1.1.0', 'pkg-b@v2.0.0']);
      expect(result.baselineTags).toEqual(['release/pkg-a@v1.1.0', 'release/pkg-b@v2.0.0']);
    });

    it('should reject a non-string per-package tag', async () => {
      const filePath = writeInput({
        dryRun: false,
        updates: [{ packageName: 'pkg-a', newVersion: '1.1.0', filePath: 'packages/a/package.json', tag: 42 }],
        changelogs: [],
        tags: [],
      });

      await expect(parseInput(filePath)).rejects.toHaveProperty('code', PublishErrorCode.INPUT_VALIDATION_ERROR);
    });

    it('should round-trip every VersionOutput field unchanged', async () => {
      // Required<> makes a new VersionOutput field a type error here until the fixture carries it.
      const entry: Required<VersionChangelogEntry> = {
        type: 'feat',
        description: 'Add per-package tags',
        issueIds: ['12', '34'],
        prNumber: '34',
        scope: 'publish',
        originalType: 'feature',
        breaking: true,
        synthetic: false,
      };
      const update: Required<VersionPackageUpdate> = {
        packageName: '@scope/a',
        newVersion: '2.0.0',
        previousVersion: '1.4.0',
        filePath: 'packages/a/package.json',
        tag: '@scope/a@v2.0.0',
        isRoot: false,
        group: 'core',
        role: 'prerequisite',
        prerequisiteOf: ['@scope/b'],
        action: 'bumped',
        actionReason: 'Bumped by commits.',
        channel: 'stable',
      };
      const changelog: Required<VersionPackageChangelog> = {
        packageName: '@scope/a',
        version: '2.0.0',
        previousVersion: '1.4.0',
        revisionRange: '@scope/a@v1.4.0..HEAD',
        repoUrl: 'https://github.com/example/repo',
        entries: [entry],
      };
      const output: Required<VersionOutput> = {
        dryRun: false,
        strategy: 'group',
        updates: [update],
        changelogs: [changelog],
        sharedEntries: [{ ...entry, scope: 'ci' }],
        commitMessage: 'chore: release @scope/a@v2.0.0 [skip ci]',
        tags: ['@scope/a@v2.0.0'],
        baselineTags: ['release/@scope/a@v2.0.0'],
      };

      await expect(parseInput(writeInput(output))).resolves.toStrictEqual(output);
    });
  });
});
