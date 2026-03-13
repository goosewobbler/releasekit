import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { debug } from '@releasekit/core';

export type NpmAuthMethod = 'oidc' | 'token' | null;

export interface NpmEnvIsolation {
  env: Record<string, string | undefined>;
  cleanup: () => void;
}

function writeTempNpmrc(contents: string): { npmrcPath: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'releasekit-npmrc-'));
  const npmrcPath = path.join(dir, '.npmrc');
  fs.writeFileSync(npmrcPath, contents, 'utf-8');
  return {
    npmrcPath,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    },
  };
}

/**
 * Create an isolated npm config environment for subprocesses.
 *
 * Why: npm OIDC trusted publishing can be blocked by token-based config/env (e.g. NODE_AUTH_TOKEN,
 * setup-node injected auth settings). We isolate user config so OIDC mode doesn't accidentally use
 * token auth.
 */
export function createNpmSubprocessIsolation(options: {
  authMethod: NpmAuthMethod;
  registryUrl: string;
}): NpmEnvIsolation {
  const { authMethod, registryUrl } = options;

  // Default: no isolation. Still allow targeted env unsets.
  const baseEnv: Record<string, string | undefined> = {};

  if (!authMethod) return { env: baseEnv, cleanup: () => {} };

  const token = process.env.NPM_TOKEN ?? process.env.NODE_AUTH_TOKEN;
  const registryHost = (() => {
    try {
      return new URL(registryUrl).host;
    } catch {
      return 'registry.npmjs.org';
    }
  })();

  const lines: string[] = [`registry=${registryUrl}`, 'always-auth=false'];

  if (authMethod === 'token' && token) {
    // Use registry-scoped token to avoid affecting other registries.
    lines.push(`//${registryHost}/:_authToken=${token}`);
  }

  lines.push('');

  const { npmrcPath, cleanup } = writeTempNpmrc(lines.join('\n'));

  debug(`Using isolated npm userconfig: ${npmrcPath}`);

  const isOidc = authMethod === 'oidc';

  return {
    env: {
      ...baseEnv,
      // Ensure npm and tools that read npm_config_* pick up our temp file
      NPM_CONFIG_USERCONFIG: npmrcPath,
      npm_config_userconfig: npmrcPath,
      NPM_CONFIG_ALWAYS_AUTH: 'false',
      npm_config_always_auth: 'false',
      // Auth-specific hardening
      ...(isOidc
        ? {
            // Explicitly prevent token-based publishing from being selected implicitly
            NODE_AUTH_TOKEN: undefined,
            NPM_TOKEN: undefined,
          }
        : {
            // Ensure CLIs that expect NODE_AUTH_TOKEN can still work
            NODE_AUTH_TOKEN: token,
          }),
    },
    cleanup,
  };
}
