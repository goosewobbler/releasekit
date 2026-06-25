import { createGitCli } from '@releasekit/git';

export function detectNpmAuth(): 'oidc' | 'token' | null {
  if (process.env.ACTIONS_ID_TOKEN_REQUEST_URL) {
    return 'oidc';
  }
  if (process.env.NPM_TOKEN || process.env.NODE_AUTH_TOKEN) {
    return 'token';
  }
  return null;
}

export function hasCargoAuth(): boolean {
  return !!process.env.CARGO_REGISTRY_TOKEN;
}

/** Returns true if PUB_TOKEN is set (token auth). Without it, OIDC automated publishing is assumed. */
export function hasPubTokenAuth(): boolean {
  return !!process.env.PUB_TOKEN;
}

export async function detectGitPushMethod(remote: string, cwd: string): Promise<'ssh' | 'https'> {
  const url = (await createGitCli().remoteUrl(remote, cwd)) ?? '';

  if (url.startsWith('git@') || url.startsWith('ssh://')) {
    return 'ssh';
  }
  return 'https';
}
