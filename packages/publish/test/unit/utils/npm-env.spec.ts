import * as fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { createNpmSubprocessIsolation } from '../../../src/utils/npm-env.js';

describe('npm env isolation', () => {
  const createdPaths: string[] = [];

  afterEach(() => {
    for (const p of createdPaths) {
      try {
        // cleanup removes the parent dir, but keep it defensive
        fs.rmSync(p, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
    createdPaths.length = 0;
    delete process.env.NPM_TOKEN;
    delete process.env.NODE_AUTH_TOKEN;
  });

  it('should not create isolation when auth method is null', () => {
    const iso = createNpmSubprocessIsolation({ authMethod: null, registryUrl: 'https://registry.npmjs.org' });
    expect(Object.keys(iso.env)).toHaveLength(0);
    iso.cleanup();
  });

  it('should create isolated userconfig for oidc and unset token env vars', () => {
    process.env.NPM_TOKEN = 'should_not_be_used';
    process.env.NODE_AUTH_TOKEN = 'should_not_be_used';

    const iso = createNpmSubprocessIsolation({ authMethod: 'oidc', registryUrl: 'https://registry.npmjs.org' });

    expect(iso.env.NPM_CONFIG_USERCONFIG).toBeTruthy();
    expect(iso.env.npm_config_userconfig).toBe(iso.env.NPM_CONFIG_USERCONFIG);
    expect(iso.env.NPM_TOKEN).toBeUndefined();
    expect(iso.env.NODE_AUTH_TOKEN).toBeUndefined();

    const npmrcPath = iso.env.NPM_CONFIG_USERCONFIG as string;
    createdPaths.push(npmrcPath);
    const content = fs.readFileSync(npmrcPath, 'utf-8');
    expect(content).toContain('registry=https://registry.npmjs.org');
    expect(content).toContain('always-auth=false');

    iso.cleanup();
  });

  it('should create isolated userconfig for token auth and include scoped _authToken', () => {
    process.env.NPM_TOKEN = 'npm_test_token';

    const iso = createNpmSubprocessIsolation({ authMethod: 'token', registryUrl: 'https://registry.npmjs.org' });

    expect(iso.env.NPM_CONFIG_USERCONFIG).toBeTruthy();
    expect(iso.env.NODE_AUTH_TOKEN).toBe('npm_test_token');
    // always-auth should not be set for token auth (only relevant for OIDC)
    expect(iso.env.NPM_CONFIG_ALWAYS_AUTH).toBeUndefined();

    const npmrcPath = iso.env.NPM_CONFIG_USERCONFIG as string;
    createdPaths.push(npmrcPath);
    const content = fs.readFileSync(npmrcPath, 'utf-8');
    expect(content).toContain('//registry.npmjs.org/:_authToken=npm_test_token');
    expect(content).not.toContain('always-auth');

    iso.cleanup();
  });
});
