import { Octokit } from '@octokit/rest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PRContext } from '../../src/core/types.js';
import { fetchPullRequestContext, parseIssueNumbers, resolveGitHubToken } from '../../src/llm/context/prFetcher.js';

vi.mock('@octokit/rest', () => ({ Octokit: vi.fn() }));

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

describe('fetchPullRequestContext()', () => {
  let mockGet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGet = vi.fn();
    vi.mocked(Octokit).mockImplementation(
      class {
        rest = { issues: { get: mockGet } };
      } as unknown as typeof Octokit,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should populate cache with fetched PR data', async () => {
    mockGet.mockResolvedValue({ data: { title: 'Add feature', body: 'PR body content', pull_request: {} } });
    const cache = new Map<number, PRContext>();

    await fetchPullRequestContext('owner', 'repo', [42], 'token', cache);

    expect(cache.has(42)).toBe(true);
    expect(cache.get(42)).toMatchObject({ number: 42, title: 'Add feature', body: 'PR body content' });
  });

  it('should skip numbers already in cache', async () => {
    const existing: PRContext = { number: 1, title: 'Cached', body: 'cached body' };
    const cache = new Map([[1, existing]]);

    await fetchPullRequestContext('owner', 'repo', [1], 'token', cache);

    expect(mockGet).not.toHaveBeenCalled();
  });

  it('should handle missing PR body gracefully', async () => {
    mockGet.mockResolvedValue({ data: { title: 'No body', body: null, pull_request: {} } });
    const cache = new Map<number, PRContext>();

    await fetchPullRequestContext('owner', 'repo', [7], 'token', cache);

    expect(cache.get(7)?.body).toBe('');
  });

  it('should skip entry on fetch error without throwing', async () => {
    mockGet.mockRejectedValue(new Error('not found'));
    const cache = new Map<number, PRContext>();

    await expect(fetchPullRequestContext('owner', 'repo', [99], 'token', cache)).resolves.not.toThrow();
    expect(cache.has(99)).toBe(false);
  });

  it('should sanitise HTML comments from body', async () => {
    mockGet.mockResolvedValue({
      data: { title: 'Test', body: 'Before<!-- hidden comment -->After', pull_request: {} },
    });
    const cache = new Map<number, PRContext>();

    await fetchPullRequestContext('owner', 'repo', [1], 'token', cache);

    expect(cache.get(1)?.body).toBe('BeforeAfter');
  });

  it('should strip images from body', async () => {
    mockGet.mockResolvedValue({
      data: { title: 'Test', body: 'Text ![screenshot](https://example.com/img.png) more text', pull_request: {} },
    });
    const cache = new Map<number, PRContext>();

    await fetchPullRequestContext('owner', 'repo', [1], 'token', cache);

    expect(cache.get(1)?.body).not.toContain('![');
    expect(cache.get(1)?.body).toContain('Text');
    expect(cache.get(1)?.body).toContain('more text');
  });

  it('should strip <details> blocks from body', async () => {
    mockGet.mockResolvedValue({
      data: {
        title: 'Test',
        body: 'Before<details><summary>Click</summary>Hidden</details>After',
        pull_request: {},
      },
    });
    const cache = new Map<number, PRContext>();

    await fetchPullRequestContext('owner', 'repo', [1], 'token', cache);

    expect(cache.get(1)?.body).not.toContain('<details>');
    expect(cache.get(1)?.body).toContain('Before');
    expect(cache.get(1)?.body).toContain('After');
  });

  it('should truncate long bodies to ~2 KB', async () => {
    const longBody = 'a'.repeat(4000);
    mockGet.mockResolvedValue({ data: { title: 'Long', body: longBody, pull_request: {} } });
    const cache = new Map<number, PRContext>();

    await fetchPullRequestContext('owner', 'repo', [1], 'token', cache);

    expect(cache.get(1)!.body.length).toBeLessThanOrEqual(2100);
  });

  it('should skip plain issues (non-PR) without caching them', async () => {
    mockGet.mockResolvedValue({ data: { title: 'Plain issue', body: 'issue body' } });
    const cache = new Map<number, PRContext>();

    await fetchPullRequestContext('owner', 'repo', [5], 'token', cache);

    expect(cache.has(5)).toBe(false);
  });

  it('should fetch multiple numbers in parallel', async () => {
    mockGet.mockResolvedValue({ data: { title: 'PR', body: 'body', pull_request: {} } });
    const cache = new Map<number, PRContext>();

    await fetchPullRequestContext('owner', 'repo', [1, 2, 3], 'token', cache);

    expect(mockGet).toHaveBeenCalledTimes(3);
    expect(cache.size).toBe(3);
  });
});
