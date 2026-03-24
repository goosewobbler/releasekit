import { describe, expect, it } from 'vitest';
import { parseRepoUrl } from '../../../src/output/github-release.js';

describe('parseRepoUrl', () => {
  it('should parse HTTPS URL', () => {
    const result = parseRepoUrl('https://github.com/owner/repo');

    expect(result).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('should parse HTTPS URL with .git suffix', () => {
    const result = parseRepoUrl('https://github.com/owner/repo.git');

    expect(result).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('should parse SSH URL', () => {
    const result = parseRepoUrl('git@github.com:owner/repo.git');

    expect(result).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('should parse SSH URL without .git suffix', () => {
    const result = parseRepoUrl('git@github.com:owner/repo');

    expect(result).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('should parse short form URL', () => {
    const result = parseRepoUrl('github.com/owner/repo');

    expect(result).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('should return null for invalid URL', () => {
    expect(parseRepoUrl('https://gitlab.com/owner/repo')).toBeNull();
    expect(parseRepoUrl('invalid')).toBeNull();
    expect(parseRepoUrl('')).toBeNull();
  });

  it('should handle URLs with extra paths', () => {
    const result = parseRepoUrl('https://github.com/owner/repo/tree/main');

    expect(result).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('should handle URLs with trailing slash', () => {
    const result = parseRepoUrl('https://github.com/owner/repo/');

    expect(result).toEqual({ owner: 'owner', repo: 'repo' });
  });
});
