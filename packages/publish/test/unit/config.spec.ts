import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getDefaultConfig, loadConfig } from '../../src/config.js';
import { PublishErrorCode } from '../../src/errors/index.js';

describe('config', () => {
  const tmpDirs: string[] = [];

  function createTmpDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'releasekit-publish-test-'));
    tmpDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  describe('getDefaultConfig', () => {
    it('should return sensible defaults', () => {
      const config = getDefaultConfig();

      expect(config.npm.enabled).toBe(true);
      expect(config.npm.auth).toBe('auto');
      expect(config.npm.provenance).toBe(true);
      expect(config.npm.access).toBe('public');
      expect(config.npm.copyFiles).toEqual(['LICENSE']);
      expect(config.npm.tag).toBe('latest');

      expect(config.cargo.enabled).toBe(false);
      expect(config.cargo.noVerify).toBe(false);
      expect(config.cargo.publishOrder).toEqual([]);

      expect(config.git.push).toBe(true);
      expect(config.git.pushMethod).toBe('auto');
      expect(config.git.remote).toBe('origin');
      expect(config.git.branch).toBe('main');

      expect(config.githubRelease.enabled).toBe(true);
      expect(config.githubRelease.draft).toBe(true);
      expect(config.githubRelease.perPackage).toBe(false);

      expect(config.verify.npm.enabled).toBe(true);
      expect(config.verify.npm.maxAttempts).toBe(5);
      expect(config.verify.cargo.maxAttempts).toBe(10);
      expect(config.verify.cargo.initialDelay).toBe(30000);
    });
  });

  describe('loadConfig', () => {
    it('should return defaults when no config file exists', () => {
      const dir = createTmpDir();
      const config = loadConfig(dir);
      expect(config).toEqual(getDefaultConfig());
    });

    it('should load and parse config file', () => {
      const dir = createTmpDir();
      fs.writeFileSync(
        path.join(dir, 'publish.config.json'),
        JSON.stringify({
          npm: { access: 'restricted' },
          cargo: { enabled: true, noVerify: true },
        }),
      );

      const config = loadConfig(dir);
      expect(config.npm.access).toBe('restricted');
      expect(config.npm.enabled).toBe(true); // default preserved
      expect(config.cargo.enabled).toBe(true);
      expect(config.cargo.noVerify).toBe(true);
    });

    it('should load from explicit config path', () => {
      const dir = createTmpDir();
      const customPath = path.join(dir, 'custom.json');
      fs.writeFileSync(customPath, JSON.stringify({ git: { branch: 'develop' } }));

      const config = loadConfig(dir, customPath);
      expect(config.git.branch).toBe('develop');
    });

    it('should throw on invalid JSON', () => {
      const dir = createTmpDir();
      fs.writeFileSync(path.join(dir, 'publish.config.json'), 'not json');

      expect(() => loadConfig(dir)).toThrow();
    });

    it('should throw on invalid config values', () => {
      const dir = createTmpDir();
      fs.writeFileSync(path.join(dir, 'publish.config.json'), JSON.stringify({ npm: { auth: 'invalid-value' } }));

      let thrownError: unknown;
      try {
        loadConfig(dir);
      } catch (error: unknown) {
        thrownError = error;
      }
      expect(thrownError).toHaveProperty('code', PublishErrorCode.CONFIG_ERROR);
    });
  });
});
