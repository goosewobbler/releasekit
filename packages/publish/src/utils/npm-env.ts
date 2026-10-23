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
  // Carries an auth token, so owner-only even if the enclosing 0700 mkdtemp dir's protection is ever weakened.
  fs.writeFileSync(npmrcPath, contents, { encoding: 'utf-8', mode: 0o600 });
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
 * Token-based npm config (e.g. setup-node's injected auth settings) can block OIDC trusted publishing, so
 * subprocesses get an isolated userconfig.
 */
export function createNpmSubprocessIsolation(options: {
  authMethod: NpmAuthMethod;
  registryUrl: string;
}): NpmEnvIsolation {
  const { authMethod, registryUrl } = options;

  const baseEnv: Record<string, string | undefined> = {};

  if (!authMethod) {
    return { env: baseEnv, cleanup: () => {} };
  }

  const token = process.env.NPM_TOKEN ?? process.env.NODE_AUTH_TOKEN;
  const registryHost = (() => {
    try {
      return new URL(registryUrl).host;
    } catch {
      return 'registry.npmjs.org';
    }
  })();

  // OIDC needs only the registry line; npm performs the trusted-publishing exchange itself.
  const lines: string[] = [`registry=${registryUrl}`];

  if (authMethod === 'token' && token) {
    // Registry-scoped so the token isn't sent to other registries.
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
      ...(isOidc
        ? {
            // An ambient token would override OIDC trusted publishing
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
