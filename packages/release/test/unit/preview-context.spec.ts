import * as fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolvePreviewContext } from '../../src/preview-context.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const mockedFs = vi.mocked(fs);

describe('resolvePreviewContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('GITHUB_TOKEN', 'test-token');
    vi.stubEnv('GITHUB_REPOSITORY', 'owner/repo');
    vi.stubEnv('GITHUB_EVENT_PATH', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('throws when GITHUB_TOKEN is not set', () => {
    vi.stubEnv('GITHUB_TOKEN', '');
    delete process.env.GITHUB_TOKEN;

    expect(() => resolvePreviewContext({})).toThrow('GITHUB_TOKEN');
  });

  it('uses CLI flags for PR number and repo', () => {
    const result = resolvePreviewContext({ pr: '42', repo: 'my-org/my-repo' });

    expect(result).toEqual({
      prNumber: 42,
      owner: 'my-org',
      repo: 'my-repo',
      token: 'test-token',
    });
  });

  it('auto-detects PR number from GitHub event payload', () => {
    const eventPath = '/tmp/event.json';
    vi.stubEnv('GITHUB_EVENT_PATH', eventPath);
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify({ pull_request: { number: 99 } }));

    const result = resolvePreviewContext({});

    expect(result.prNumber).toBe(99);
    expect(mockedFs.readFileSync).toHaveBeenCalledWith(eventPath, 'utf-8');
  });

  it('falls through to error on malformed JSON in event payload', () => {
    const eventPath = '/tmp/event.json';
    vi.stubEnv('GITHUB_EVENT_PATH', eventPath);
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue('not valid json{');

    expect(() => resolvePreviewContext({})).toThrow('Could not determine PR number');
  });

  it('auto-detects repo from GITHUB_REPOSITORY', () => {
    vi.stubEnv('GITHUB_REPOSITORY', 'goosewobbler/releasekit');

    const result = resolvePreviewContext({ pr: '1' });

    expect(result.owner).toBe('goosewobbler');
    expect(result.repo).toBe('releasekit');
  });

  it('throws on invalid PR number', () => {
    expect(() => resolvePreviewContext({ pr: 'abc' })).toThrow('Invalid PR number');
    expect(() => resolvePreviewContext({ pr: '0' })).toThrow('Invalid PR number');
    expect(() => resolvePreviewContext({ pr: '-1' })).toThrow('Invalid PR number');
  });

  it('throws on invalid repo format', () => {
    expect(() => resolvePreviewContext({ pr: '1', repo: 'invalid' })).toThrow('Invalid repository format');
    expect(() => resolvePreviewContext({ pr: '1', repo: 'a/b/c' })).toThrow('Invalid repository format');
  });

  it('throws when PR number cannot be determined', () => {
    vi.stubEnv('GITHUB_EVENT_PATH', '');
    delete process.env.GITHUB_EVENT_PATH;

    expect(() => resolvePreviewContext({})).toThrow('Could not determine PR number');
  });

  it('throws when repo cannot be determined', () => {
    vi.stubEnv('GITHUB_REPOSITORY', '');
    delete process.env.GITHUB_REPOSITORY;

    expect(() => resolvePreviewContext({ pr: '1' })).toThrow('Could not determine repository');
  });
});
