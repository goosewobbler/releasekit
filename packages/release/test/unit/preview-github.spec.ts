import { createFakeForge } from '@releasekit/forge';
import type { FakeGit, FakeGitSeed } from '@releasekit/git';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPRLabels, findPreviewComment, findStandingPR, postOrUpdateComment } from '../../src/github.js';

// The merge-PR lookup is driven by seeded `describeTags` (nearest tag) and `log` (commit SHAs).
let fakeGit: FakeGit;
vi.mock('@releasekit/git', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@releasekit/git')>();
  return { ...actual, createGitCli: () => fakeGit };
});

describe('findPreviewComment', () => {
  it('should return comment ID when marker is found', async () => {
    const forge = createFakeForge({
      comments: [
        { id: 1, body: 'Some other comment' },
        { id: 2, body: '<!-- releasekit-preview -->\n## Release Preview' },
      ],
    });

    const result = await findPreviewComment(forge, 1);
    expect(result).toBe(2);
  });

  it('should return null when no marker comment exists', async () => {
    const forge = createFakeForge({
      comments: [
        { id: 1, body: 'Regular comment' },
        { id: 2, body: 'Another comment' },
      ],
    });

    const result = await findPreviewComment(forge, 1);
    expect(result).toBeNull();
  });

  it('should return null when no comments exist', async () => {
    const forge = createFakeForge({ comments: [] });

    const result = await findPreviewComment(forge, 1);
    expect(result).toBeNull();
  });
});

describe('postOrUpdateComment', () => {
  it('should create a new comment when none exists', async () => {
    const forge = createFakeForge({ comments: [] });
    const body = '<!-- releasekit-preview -->\n## Release Preview';

    await postOrUpdateComment(forge, 1, body);

    expect(forge.createdComments).toEqual([{ prNumber: 1, body }]);
    expect(forge.updatedComments).toEqual([]);
  });

  it('should update existing comment when marker is found', async () => {
    const forge = createFakeForge({ comments: [{ id: 42, body: '<!-- releasekit-preview -->\nOld content' }] });
    const body = '<!-- releasekit-preview -->\n## Release Preview (updated)';

    await postOrUpdateComment(forge, 1, body);

    expect(forge.updatedComments).toEqual([{ commentId: 42, body }]);
    expect(forge.createdComments).toEqual([]);
  });
});

describe('fetchPRLabels', () => {
  function forgeWithLabels(labels: string[]) {
    return createFakeForge({ issues: { 1: { body: '', title: '', labels, isPullRequest: true } } });
  }

  it('should return label names from PR', async () => {
    const forge = forgeWithLabels(['release:graduate', 'bug']);

    const labels = await fetchPRLabels(forge, 1);
    expect(labels).toEqual(['release:graduate', 'bug']);
  });

  it('should handle string labels', async () => {
    const forge = forgeWithLabels(['release:graduate', 'enhancement']);

    const labels = await fetchPRLabels(forge, 1);
    expect(labels).toEqual(['release:graduate', 'enhancement']);
  });

  it('should return empty array when no labels', async () => {
    const forge = forgeWithLabels([]);

    const labels = await fetchPRLabels(forge, 1);
    expect(labels).toEqual([]);
  });
});

describe('findStandingPR', () => {
  it('should return the PR number and URL when found', async () => {
    const forge = createFakeForge({
      standingPR: { number: 42, url: 'https://github.com/owner/repo/pull/42', labels: [] },
    });
    const result = await findStandingPR(forge, undefined);
    expect(result).toEqual({ number: 42, url: 'https://github.com/owner/repo/pull/42' });
  });

  it('should return null when no open standing PR found', async () => {
    const forge = createFakeForge({ standingPR: null });
    const result = await findStandingPR(forge, undefined);
    expect(result).toBeNull();
  });

  it('should use the configured branch from ciConfig', async () => {
    const forge = createFakeForge({ standingPR: null });
    const spy = vi.spyOn(forge, 'findStandingPR');
    await findStandingPR(forge, { standingPr: { branch: 'release/staging' } } as Parameters<typeof findStandingPR>[1]);
    expect(spy).toHaveBeenCalledWith('release/staging');
  });

  it('should default to release/next when ciConfig has no standingPr', async () => {
    const forge = createFakeForge({ standingPR: null });
    const spy = vi.spyOn(forge, 'findStandingPR');
    await findStandingPR(forge, undefined);
    expect(spy).toHaveBeenCalledWith('release/next');
  });

  it('should return null when API throws', async () => {
    const forge = createFakeForge({ standingPR: null });
    vi.spyOn(forge, 'findStandingPR').mockRejectedValue(new Error('API error'));
    const result = await findStandingPR(forge, undefined);
    expect(result).toBeNull();
  });
});
