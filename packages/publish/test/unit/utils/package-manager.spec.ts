import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPublishCommand, buildViewCommand, detectPackageManager } from '../../../src/utils/package-manager.js';

describe('package-manager utilities', () => {
  const tmpDirs: string[] = [];

  function createTmpDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'releasekit-pm-test-'));
    tmpDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  describe('detectPackageManager', () => {
    it('should detect pnpm from pnpm-lock.yaml', () => {
      const dir = createTmpDir();
      fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');

      expect(detectPackageManager(dir)).toBe('pnpm');
    });

    it('should detect yarn from yarn.lock', () => {
      const dir = createTmpDir();
      fs.writeFileSync(path.join(dir, 'yarn.lock'), '');

      expect(detectPackageManager(dir)).toBe('yarn');
    });

    it('should default to npm when no lockfile found', () => {
      const dir = createTmpDir();

      expect(detectPackageManager(dir)).toBe('npm');
    });

    it('should prefer pnpm over yarn when both exist', () => {
      const dir = createTmpDir();
      fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');
      fs.writeFileSync(path.join(dir, 'yarn.lock'), '');

      expect(detectPackageManager(dir)).toBe('pnpm');
    });
  });

  describe('buildPublishCommand', () => {
    const defaultOptions = { access: 'public', tag: 'latest', provenance: false, noGitChecks: true };

    it('should build pnpm publish command', () => {
      const result = buildPublishCommand('pnpm', '@test/pkg', '/pkg', defaultOptions);

      expect(result.file).toBe('pnpm');
      expect(result.args).toContain('publish');
      expect(result.args).toEqual(['publish', '--access', 'public', '--tag', 'latest', '--no-git-checks']);
    });

    it('should build npm publish command', () => {
      const result = buildPublishCommand('npm', '@test/pkg', '/pkg', defaultOptions);

      expect(result.file).toBe('npm');
      expect(result.args).toContain('publish');
      expect(result.args).toEqual(expect.arrayContaining(['--access', 'public']));
      expect(result.args).not.toContain('--filter');
    });

    it('should add --provenance when requested', () => {
      const result = buildPublishCommand('pnpm', '@test/pkg', '/pkg', { ...defaultOptions, provenance: true });

      expect(result.args).toContain('--provenance');
    });

    it('should not add --provenance when not requested', () => {
      const result = buildPublishCommand('pnpm', '@test/pkg', '/pkg', defaultOptions);

      expect(result.args).not.toContain('--provenance');
    });
  });

  describe('buildViewCommand', () => {
    it('should use pnpm view for pnpm', () => {
      const result = buildViewCommand('pnpm', '@test/pkg', '1.0.0');

      expect(result.file).toBe('pnpm');
      expect(result.args).toEqual(['view', '@test/pkg@1.0.0', 'version', '--json']);
    });

    it('should use npm view for npm', () => {
      const result = buildViewCommand('npm', '@test/pkg', '1.0.0');

      expect(result.file).toBe('npm');
      expect(result.args).toEqual(['view', '@test/pkg@1.0.0', 'version', '--json']);
    });

    it('should use npm view for yarn', () => {
      const result = buildViewCommand('yarn', '@test/pkg', '1.0.0');

      expect(result.file).toBe('npm');
      expect(result.args).toEqual(['view', '@test/pkg@1.0.0', 'version', '--json']);
    });
  });
});
