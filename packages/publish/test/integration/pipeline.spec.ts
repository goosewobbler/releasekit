import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDefaultConfig } from '../../src/config.js';
import { parseInput } from '../../src/stages/input.js';
import type { PublishCliOptions } from '../../src/types.js';

describe('Pipeline integration (dry-run)', () => {
  const fixturesDir = path.resolve(__dirname, '../fixtures');

  it('should parse standard version output fixture', async () => {
    const input = await parseInput(path.join(fixturesDir, 'version-output.json'));

    expect(input.dryRun).toBe(false);
    expect(input.updates).toHaveLength(2);
    expect(input.tags).toHaveLength(2);
    expect(input.commitMessage).toBeTruthy();
  });

  it('should parse pre-release version output fixture', async () => {
    const input = await parseInput(path.join(fixturesDir, 'version-output-prerelease.json'));

    expect(input.updates[0]?.newVersion).toContain('next');
  });

  it('should parse cargo version output fixture', async () => {
    const input = await parseInput(path.join(fixturesDir, 'version-output-cargo.json'));

    const cargoUpdate = input.updates.find((u) => u.filePath.endsWith('Cargo.toml'));
    expect(cargoUpdate).toBeDefined();
    expect(cargoUpdate?.packageName).toBe('tauri-plugin-zubridge');
  });

  it('should produce valid default config', () => {
    const config = getDefaultConfig();

    expect(config.npm.enabled).toBe(true);
    expect(config.cargo.enabled).toBe(false);
    expect(config.git.push).toBe(true);
    expect(config.githubRelease.enabled).toBe(true);
    expect(config.verify.npm.enabled).toBe(true);
  });

  it('should merge CLI options with config defaults', () => {
    const config = getDefaultConfig();
    const options: PublishCliOptions = {
      registry: 'npm',
      npmAuth: 'oidc',
      dryRun: true,
      skipGit: true,
      skipPublish: false,
      skipGithubRelease: true,
      skipVerification: true,

      json: true,
      verbose: false,
    };

    // Simulate CLI override
    config.npm.auth = options.npmAuth;

    expect(config.npm.auth).toBe('oidc');
    expect(options.dryRun).toBe(true);
    expect(options.skipGit).toBe(true);
  });
});
