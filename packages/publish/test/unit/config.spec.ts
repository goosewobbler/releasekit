import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ConfigError } from '@releasekit/config';
import { afterEach, describe, expect, it } from 'vitest';
import { getDefaultConfig, loadConfig } from '../../src/config.js';

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

      expect(config.cargo.enabled).toBe(true);
      expect(config.cargo.noVerify).toBe(false);
      expect(config.cargo.publishOrder).toEqual([]);

      expect(config.pub.enabled).toBe(true);
      expect(config.pub.publishOrder).toEqual([]);

      expect(config.git.push).toBe(true);
      expect(config.git.pushMethod).toBe('auto');
      expect(config.git.remote).toBe('origin');
      expect(config.git.branch).toBeUndefined();

      expect(config.githubRelease.enabled).toBe(true);
      expect(config.githubRelease.draft).toBe(true);
      expect(config.githubRelease.perPackage).toBe(true);
      expect(config.githubRelease.body).toBe('auto');

      expect(config.verify.npm.enabled).toBe(true);
      expect(config.verify.npm.maxAttempts).toBe(5);
      expect(config.verify.cargo.maxAttempts).toBe(10);
      expect(config.verify.cargo.initialDelay).toBe(30000);
    });

    it('should not share nested objects between calls', () => {
      const first = getDefaultConfig();
      first.verify.pub.enabled = false;
      first.npm.copyFiles.push('README.md');

      const second = getDefaultConfig();
      expect(second.verify.pub.enabled).toBe(true);
      expect(second.npm.copyFiles).toEqual(['LICENSE']);
    });
  });

  describe('loadConfig', () => {
    it.each([
      ['no config file', undefined],
      ['no publish block', { version: {} }],
      ['an empty publish block', { publish: {} }],
    ])('should return the defaults with %s', (_label, fileConfig) => {
      const dir = createTmpDir();
      if (fileConfig) {
        fs.writeFileSync(path.join(dir, 'releasekit.config.json'), JSON.stringify(fileConfig));
      }

      const config = loadConfig({ cwd: dir });
      expect(config).toEqual(getDefaultConfig());
      expect([config.npm.enabled, config.cargo.enabled, config.pub.enabled]).toEqual([true, true, true]);
    });

    it('should inherit the top-level git config without a publish block', () => {
      const dir = createTmpDir();
      fs.writeFileSync(
        path.join(dir, 'releasekit.config.json'),
        JSON.stringify({ git: { push: false, remote: 'upstream' } }),
      );

      const config = loadConfig({ cwd: dir });
      expect(config.git.push).toBe(false);
      expect(config.git.remote).toBe('upstream');
    });

    it('should load and parse config file', () => {
      const dir = createTmpDir();
      fs.writeFileSync(
        path.join(dir, 'releasekit.config.json'),
        JSON.stringify({
          publish: {
            npm: { access: 'restricted' },
            cargo: { enabled: true, noVerify: true },
          },
        }),
      );

      const config = loadConfig({ cwd: dir });
      expect(config.npm.access).toBe('restricted');
      expect(config.npm.enabled).toBe(true);
      expect(config.cargo.enabled).toBe(true);
      expect(config.cargo.noVerify).toBe(true);
    });

    it('should load from explicit config path', () => {
      const dir = createTmpDir();
      const customPath = path.join(dir, 'custom.json');
      fs.writeFileSync(
        customPath,
        JSON.stringify({
          publish: {
            git: { branch: 'develop' },
          },
        }),
      );

      const config = loadConfig({ cwd: dir, configPath: customPath });
      expect(config.git.branch).toBe('develop');
    });

    it('should throw on invalid JSON', () => {
      const dir = createTmpDir();
      fs.writeFileSync(path.join(dir, 'releasekit.config.json'), 'not json');

      expect(() => loadConfig({ cwd: dir })).toThrow(ConfigError);
    });

    it('should throw on invalid config values', () => {
      const dir = createTmpDir();
      fs.writeFileSync(
        path.join(dir, 'releasekit.config.json'),
        JSON.stringify({
          publish: {
            npm: { auth: 'invalid-value' },
          },
        }),
      );

      expect(() => loadConfig({ cwd: dir })).toThrow(ConfigError);
    });
  });
});
