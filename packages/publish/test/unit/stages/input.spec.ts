import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
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
  });
});
