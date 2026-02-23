import { describe, expect, it } from 'vitest';
import { parseRepoUrl } from '../../../src/output/github-release.js';

describe('parseRepoUrl', () => {
  it('parses HTTPS URL', () => {
    const result = parseRepoUrl('https://github.com/owner/repo');

    expect(result).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('parses HTTPS URL with .git suffix', () => {
    const result = parseRepoUrl('https://github.com/owner/repo.git');

    expect(result).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('parses SSH URL', () => {
    const result = parseRepoUrl('git@github.com:owner/repo.git');

    expect(result).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('parses SSH URL without .git suffix', () => {
    const result = parseRepoUrl('git@github.com:owner/repo');

    expect(result).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('parses short form URL', () => {
    const result = parseRepoUrl('github.com/owner/repo');

    expect(result).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('returns null for invalid URL', () => {
    expect(parseRepoUrl('https://gitlab.com/owner/repo')).toBeNull();
    expect(parseRepoUrl('invalid')).toBeNull();
    expect(parseRepoUrl('')).toBeNull();
  });

  it('handles URLs with extra paths', () => {
    const result = parseRepoUrl('https://github.com/owner/repo/tree/main');

    expect(result).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('handles URLs with trailing slash', () => {
    const result = parseRepoUrl('https://github.com/owner/repo/');

    expect(result).toEqual({ owner: 'owner', repo: 'repo' });
  });
});
