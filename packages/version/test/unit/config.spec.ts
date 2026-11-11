import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('Config', () => {
  const tmpDirs: string[] = [];

  function createTmpDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'releasekit-version-test-'));
    tmpDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  describe('loadConfig', () => {
    it('should apply the schema defaults when there is no version block', () => {
      const noVersionBlock = createTmpDir();
      fs.writeFileSync(path.join(noVersionBlock, 'releasekit.config.json'), JSON.stringify({ git: {} }));
      const emptyVersionBlock = createTmpDir();
      fs.writeFileSync(path.join(emptyVersionBlock, 'releasekit.config.json'), JSON.stringify({ version: {} }));

      const config = loadConfig({ cwd: noVersionBlock });

      expect(config).toEqual(loadConfig({ cwd: emptyVersionBlock }));
      expect(config).toMatchObject({
        tagTemplate: '${' + 'prefix}${' + 'version}',
        versionPrefix: 'v',
        mismatchStrategy: 'warn',
        sync: true,
        packages: [],
        preset: 'conventionalcommits',
      });
    });

    it('should default tagTemplate to a per-package template with packageSpecificTags', () => {
      const dir = createTmpDir();
      fs.writeFileSync(
        path.join(dir, 'releasekit.config.json'),
        JSON.stringify({ version: { packageSpecificTags: true } }),
      );

      expect(loadConfig({ cwd: dir }).tagTemplate).toBe('${' + 'packageName}@${' + 'prefix}${' + 'version}');
    });

    it('should load config from releasekit.config.json', () => {
      const dir = createTmpDir();
      fs.writeFileSync(
        path.join(dir, 'releasekit.config.json'),
        JSON.stringify({
          version: {
            preset: 'angular',
            sync: false,
            packages: ['packages/*'],
          },
        }),
      );

      const config = loadConfig({ cwd: dir });

      expect(config.preset).toBe('angular');
      expect(config.sync).toBe(false);
      expect(config.packages).toEqual(['packages/*']);
    });

    it('should load config from custom path', () => {
      const dir = createTmpDir();
      const customPath = path.join(dir, 'custom-config.json');
      fs.writeFileSync(
        customPath,
        JSON.stringify({
          version: {
            tagTemplate: 'release-${' + 'version}',
          },
        }),
      );

      const config = loadConfig({ cwd: dir, configPath: customPath });

      expect(config.tagTemplate).toBe('release-${' + 'version}');
    });

    it('should throw on invalid JSON', () => {
      const dir = createTmpDir();
      fs.writeFileSync(path.join(dir, 'releasekit.config.json'), 'not valid json');

      expect(() => loadConfig({ cwd: dir })).toThrow();
    });

    it('should throw on invalid config values', () => {
      const dir = createTmpDir();
      fs.writeFileSync(
        path.join(dir, 'releasekit.config.json'),
        JSON.stringify({
          version: {
            zeroMajor: 'invalid-value',
          },
        }),
      );

      expect(() => loadConfig({ cwd: dir })).toThrow();
    });
  });
});
