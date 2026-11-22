import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Package } from '@manypkg/get-packages';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readVersionRecord, recordRelease, writeReleasedVersions } from '../../../src/record/versionRecord.js';

describe('version record', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rk-record-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const file = () => join(root, 'releasekit.versions.json');
  const pkg = (name: string, dir: string) => ({ dir: join(root, dir), packageJson: { name } }) as unknown as Package;

  describe('readVersionRecord', () => {
    it('should keep fields it does not know', () => {
      writeFileSync(
        file(),
        JSON.stringify({ 'packages/a': { name: 'a', version: '1.0.0', at: 'sha', channel: 'next' } }),
      );

      expect(readVersionRecord(root)).toEqual({
        'packages/a': { name: 'a', version: '1.0.0', at: 'sha', channel: 'next' },
      });
    });

    it('should fail naming the malformed field', () => {
      writeFileSync(file(), JSON.stringify({ 'packages/a': { name: 'a', version: '1.0.0' } }));

      expect(() => readVersionRecord(root)).toThrow('releasekit.versions.json is malformed at "packages/a.at"');
    });
  });

  describe('recordRelease', () => {
    it.each([
      ['a stable previous release', { name: 'a', version: '1.0.0', at: 's' }, { version: '1.0.0', at: 's' }],
      [
        "a prerelease's last stable release",
        { name: 'a', version: '1.1.0-next.0', at: 'p', lastStable: { version: '1.0.0', at: 's' } },
        { version: '1.0.0', at: 's' },
      ],
    ])('should give a prerelease %s as its last stable release', (_case, previous, lastStable) => {
      expect(recordRelease(previous, 'a', '1.1.0-next.1', 'q')).toEqual({
        name: 'a',
        version: '1.1.0-next.1',
        at: 'q',
        lastStable,
      });
    });

    it('should drop the last stable release on a stable release', () => {
      const previous = { name: 'a', version: '1.1.0-next.1', at: 'q', lastStable: { version: '1.0.0', at: 's' } };

      expect(recordRelease(previous, 'a', '1.1.0', 'r')).toEqual({ name: 'a', version: '1.1.0', at: 'r' });
    });
  });

  describe('writeReleasedVersions', () => {
    it('should update released packages, keep the rest and skip a name that is not a package', async () => {
      const record = { 'packages/b': { name: 'b', version: '2.0.0', at: 'old' } };
      const released = new Map([
        ['a', '1.1.0'],
        ['monorepo', '1.1.0'],
      ]);

      await writeReleasedVersions(
        record,
        'head',
        released,
        [pkg('a', 'packages/a'), pkg('b', 'packages/b')],
        root,
        false,
      );

      expect(JSON.parse(readFileSync(file(), 'utf-8'))).toEqual({
        'packages/a': { name: 'a', version: '1.1.0', at: 'head' },
        'packages/b': { name: 'b', version: '2.0.0', at: 'old' },
      });
    });

    it('should write nothing when nothing was released', async () => {
      await writeReleasedVersions({}, 'head', new Map(), [pkg('a', 'packages/a')], root, false);

      expect(existsSync(file())).toBe(false);
    });
  });
});
