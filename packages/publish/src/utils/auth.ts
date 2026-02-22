import { execCommand } from './exec.js';

export function detectNpmAuth(): 'oidc' | 'token' | null {
  if (process.env.ACTIONS_ID_TOKEN_REQUEST_URL) {
    return 'oidc';
  }
  if (process.env.NPM_TOKEN) {
    return 'token';
  }
  return null;
}

export function hasCargoAuth(): boolean {
  return !!process.env.CARGO_REGISTRY_TOKEN;
}

export async function detectGitPushMethod(remote: string, cwd: string): Promise<'ssh' | 'https'> {
  const result = await execCommand('git', ['remote', 'get-url', remote], { cwd });
  const url = result.stdout.trim();

  if (url.startsWith('git@') || url.startsWith('ssh://')) {
    return 'ssh';
  }
  return 'https';
}
