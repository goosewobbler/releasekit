import { describe, expect, it } from 'vitest';
import { normalizeRepoUrl } from '../../../src/backfill/repo-url.js';

describe('normalizeRepoUrl', () => {
  it('should read the string shorthand and the { url } object form', () => {
    expect(normalizeRepoUrl('https://github.com/owner/repo')).toBe('https://github.com/owner/repo');
    expect(normalizeRepoUrl({ url: 'https://github.com/owner/repo' })).toBe('https://github.com/owner/repo');
  });

  it('should strip the git+ prefix and .git suffix independently', () => {
    expect(normalizeRepoUrl('git+https://github.com/owner/repo.git')).toBe('https://github.com/owner/repo');
    expect(normalizeRepoUrl('git+https://github.com/owner/repo')).toBe('https://github.com/owner/repo');
    expect(normalizeRepoUrl('https://github.com/owner/repo.git')).toBe('https://github.com/owner/repo');
  });

  it('should return undefined when no URL is present', () => {
    expect(normalizeRepoUrl(undefined)).toBeUndefined();
    expect(normalizeRepoUrl({})).toBeUndefined();
    expect(normalizeRepoUrl({ url: 42 })).toBeUndefined();
  });
});
