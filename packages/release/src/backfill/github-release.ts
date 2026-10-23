import { execFileSync } from 'node:child_process';
import { assertNotOption, NOTES_MARKER } from '@releasekit/core';

export { NOTES_MARKER };

export type UpdateDecision =
  | { action: 'update' }
  | { action: 'skip'; reason: 'no-release' | 'already-backfilled' | 'hand-edited' };

/** A non-empty body without our marker is a suspected hand-edit, overwritten only with `force`. */
export function decideReleaseUpdate(
  existingBody: string | null,
  onlyMissing: boolean,
  force: boolean = false,
): UpdateDecision {
  if (existingBody === null) {
    return { action: 'skip', reason: 'no-release' };
  }
  if (onlyMissing && existingBody.includes(NOTES_MARKER)) {
    return { action: 'skip', reason: 'already-backfilled' };
  }
  if (!force && !onlyMissing && existingBody.trim() && !existingBody.includes(NOTES_MARKER)) {
    return { action: 'skip', reason: 'hand-edited' };
  }
  return { action: 'update' };
}

export function withMarker(body: string): string {
  return `${NOTES_MARKER}\n\n${body.trim()}\n`;
}

/**
 * `gh release view` also exits non-zero on auth, network and rate-limit failures, so only "release not found" maps to
 * null; anything else throws rather than reporting every tag as release-less.
 */
export function getReleaseBody(tag: string): string | null {
  assertNotOption(tag, 'tag');
  try {
    return execFileSync('gh', ['release', 'view', tag, '--json', 'body', '--jq', '.body'], { encoding: 'utf8' });
  } catch (err) {
    const e = err as { code?: string; stderr?: string | Buffer; message?: string };
    if (e.code === 'ENOENT') {
      throw new Error('GitHub CLI (`gh`) not found — install it and run `gh auth login` to update release bodies.');
    }
    const stderr = (typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString()) || e.message || '';
    if (/release not found/i.test(stderr)) {
      return null;
    }
    throw new Error(`\`gh release view ${tag}\` failed: ${stderr.trim() || 'unknown error'}`);
  }
}

export function editReleaseBody(tag: string, body: string): void {
  assertNotOption(tag, 'tag');
  execFileSync('gh', ['release', 'edit', tag, '--notes', body], { encoding: 'utf8' });
}

export function getReleaseInfo(tag: string): { isDraft: boolean; body: string | null } | null {
  assertNotOption(tag, 'tag');
  try {
    const json = execFileSync('gh', ['release', 'view', tag, '--json', 'isDraft,body'], { encoding: 'utf8' });
    const parsed = JSON.parse(json) as { isDraft: boolean; body: string | null };
    return parsed;
  } catch (err) {
    const e = err as { code?: string; stderr?: string | Buffer; message?: string };
    if (e.code === 'ENOENT') {
      throw new Error('GitHub CLI (`gh`) not found — install it and run `gh auth login` to update release bodies.');
    }
    const stderr = (typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString()) || e.message || '';
    if (/release not found/i.test(stderr)) {
      return null;
    }
    throw new Error(`\`gh release view ${tag}\` failed: ${stderr.trim() || 'unknown error'}`);
  }
}
