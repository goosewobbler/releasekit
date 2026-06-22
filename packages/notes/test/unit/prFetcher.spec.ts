import { createFakeForge } from '@releasekit/forge';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PRContext } from '../../src/core/types.js';
import { fetchPullRequestContext, parseIssueNumbers, resolveGitHubToken } from '../../src/llm/context/prFetcher.js';

// ---------------------------------------------------------------------------
// parseIssueNumbers
// ---------------------------------------------------------------------------

describe('parseIssueNumbers()', () => {
  it('should parse #-prefixed strings to numbers', () => {
    expect(parseIssueNumbers(['#123', '#456'])).toEqual([123, 456]);
  });

  it('should parse bare numeric strings', () => {
    expect(parseIssueNumbers(['42'])).toEqual([42]);
  });

  it('should filter out non-numeric values', () => {
    expect(parseIssueNumbers(['#abc', '', '#0'])).toEqual([]);
  });

  it('should return empty array for empty input', () => {
    expect(parseIssueNumbers([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// resolveGitHubToken
// ---------------------------------------------------------------------------

describe('resolveGitHubToken()', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('should return GITHUB_TOKEN when set', () => {
    vi.stubEnv('GITHUB_TOKEN', 'ghp_test');
    vi.stubEnv('GH_TOKEN', '');
    expect(resolveGitHubToken()).toBe('ghp_test');
  });

  it('should fall back to GH_TOKEN when GITHUB_TOKEN is absent', () => {
    vi.stubEnv('GITHUB_TOKEN', '');
    vi.stubEnv('GH_TOKEN', 'gh_fallback');
    expect(resolveGitHubToken()).toBe('gh_fallback');
  });

  it('should return undefined when neither token is set', () => {
    vi.stubEnv('GITHUB_TOKEN', '');
    vi.stubEnv('GH_TOKEN', '');
    expect(resolveGitHubToken()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// fetchPullRequestContext
// ---------------------------------------------------------------------------

/** A forge whose `getIssue` returns a PR with the given title/body. */
function forgeWithIssue(number: number, title: string, body: string) {
  return createFakeForge({ issues: { [number]: { title, body, labels: [], isPullRequest: true } } });
}

describe('fetchPullRequestContext()', () => {
  it('should populate cache with fetched PR data', async () => {
    const forge = forgeWithIssue(42, 'Add feature', 'PR body content');
    const cache = new Map<number, PRContext | null>();

    await fetchPullRequestContext('owner', 'repo', [42], 'token', cache, forge);

    expect(cache.has(42)).toBe(true);
    expect(cache.get(42)).toMatchObject({ number: 42, title: 'Add feature', body: 'PR body content' });
  });

  it('should skip numbers already in cache', async () => {
    const existing: PRContext = { number: 1, title: 'Cached', body: 'cached body' };
    const cache = new Map([[1, existing]]);
    const forge = createFakeForge();
    const getIssue = vi.spyOn(forge, 'getIssue');

    await fetchPullRequestContext('owner', 'repo', [1], 'token', cache, forge);

    expect(getIssue).not.toHaveBeenCalled();
  });

  it('should handle missing PR body gracefully', async () => {
    const forge = forgeWithIssue(7, 'No body', '');
    const cache = new Map<number, PRContext | null>();

    await fetchPullRequestContext('owner', 'repo', [7], 'token', cache, forge);

    expect(cache.get(7)?.body).toBe('');
  });

  it('should skip entry on fetch error without throwing', async () => {
    const forge = createFakeForge();
    vi.spyOn(forge, 'getIssue').mockRejectedValue(new Error('not found'));
    const cache = new Map<number, PRContext | null>();

    await expect(fetchPullRequestContext('owner', 'repo', [99], 'token', cache, forge)).resolves.not.toThrow();
    expect(cache.has(99)).toBe(false);
  });

  it('should sanitise HTML comments from body', async () => {
    const forge = forgeWithIssue(1, 'Test', 'Before<!-- hidden comment -->After');
    const cache = new Map<number, PRContext | null>();

    await fetchPullRequestContext('owner', 'repo', [1], 'token', cache, forge);

    expect(cache.get(1)?.body).toBe('BeforeAfter');
  });

  it('should handle nested/truncated HTML comment patterns', async () => {
    const forge = forgeWithIssue(1, 'Test', 'A<!--<!---->B<!--unclosedC');
    const cache = new Map<number, PRContext | null>();

    await fetchPullRequestContext('owner', 'repo', [1], 'token', cache, forge);

    expect(cache.get(1)?.body).not.toContain('<!--');
  });

  it('should strip images from body', async () => {
    const forge = forgeWithIssue(1, 'Test', 'Text ![screenshot](https://example.com/img.png) more text');
    const cache = new Map<number, PRContext | null>();

    await fetchPullRequestContext('owner', 'repo', [1], 'token', cache, forge);

    expect(cache.get(1)?.body).not.toContain('![');
    expect(cache.get(1)?.body).toContain('Text');
    expect(cache.get(1)?.body).toContain('more text');
  });

  it('should strip <details> blocks from body', async () => {
    const forge = forgeWithIssue(1, 'Test', 'Before<details><summary>Click</summary>Hidden</details>After');
    const cache = new Map<number, PRContext | null>();

    await fetchPullRequestContext('owner', 'repo', [1], 'token', cache, forge);

    expect(cache.get(1)?.body).not.toContain('<details>');
    expect(cache.get(1)?.body).toContain('Before');
    expect(cache.get(1)?.body).toContain('After');
  });

  it('should strip nested <details> blocks without leaving stray closing tags', async () => {
    const forge = forgeWithIssue(1, 'Test', 'Before<details><details>inner</details>outer</details>After');
    const cache = new Map<number, PRContext | null>();

    await fetchPullRequestContext('owner', 'repo', [1], 'token', cache, forge);

    expect(cache.get(1)?.body).not.toContain('details');
    expect(cache.get(1)?.body).not.toContain('outer');
    expect(cache.get(1)?.body).toBe('BeforeAfter');
  });

  it('should truncate long bodies to ~2 KB', async () => {
    const forge = forgeWithIssue(1, 'Long', 'a'.repeat(4000));
    const cache = new Map<number, PRContext | null>();

    await fetchPullRequestContext('owner', 'repo', [1], 'token', cache, forge);

    expect(cache.get(1)!.body.length).toBeLessThanOrEqual(2100);
  });

  it('should cache plain issues (non-PR) as null to prevent re-fetching', async () => {
    const forge = createFakeForge({
      issues: { 5: { title: 'Plain issue', body: 'issue body', labels: [], isPullRequest: false } },
    });
    const cache = new Map<number, PRContext | null>();

    await fetchPullRequestContext('owner', 'repo', [5], 'token', cache, forge);

    expect(cache.has(5)).toBe(true);
    expect(cache.get(5)).toBeNull();
  });

  it('should fetch multiple numbers in parallel', async () => {
    const forge = createFakeForge({
      issues: {
        1: { title: 'PR', body: 'body', labels: [], isPullRequest: true },
        2: { title: 'PR', body: 'body', labels: [], isPullRequest: true },
        3: { title: 'PR', body: 'body', labels: [], isPullRequest: true },
      },
    });
    const getIssue = vi.spyOn(forge, 'getIssue');
    const cache = new Map<number, PRContext | null>();

    await fetchPullRequestContext('owner', 'repo', [1, 2, 3], 'token', cache, forge);

    expect(getIssue).toHaveBeenCalledTimes(3);
    expect(cache.size).toBe(3);
  });
});
