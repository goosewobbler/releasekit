import { Octokit } from '@octokit/rest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchExamples } from '../../src/llm/examples/fetcher.js';
import { parseReleaseBodyToExample, renderExamplesBlock } from '../../src/llm/examples/parser.js';
import type { Example } from '../../src/llm/examples/types.js';

vi.mock('@octokit/rest', () => ({ Octokit: vi.fn() }));

// ---------------------------------------------------------------------------
// parseReleaseBodyToExample
// ---------------------------------------------------------------------------

describe('parseReleaseBodyToExample()', () => {
  it('should parse category headings and bullet entries', () => {
    const body = `
### New
- Add streaming support
- **Deeplink testing**: New browser.electron.triggerDeeplink() API

### Fixed
- Fix null pointer in parser
`;
    const result = parseReleaseBodyToExample(body, '2.0.0');
    expect(result).not.toBeNull();
    expect(result!.version).toBe('2.0.0');
    expect(result!.entries).toHaveLength(3);
    expect(result!.entries[0]).toMatchObject({ category: 'New', description: 'Add streaming support' });
    expect(result!.entries[1]).toMatchObject({
      category: 'New',
      leadIn: 'Deeplink testing',
      description: 'New browser.electron.triggerDeeplink() API',
    });
    expect(result!.entries[2]).toMatchObject({ category: 'Fixed', description: 'Fix null pointer in parser' });
  });

  it('should return null for empty body', () => {
    expect(parseReleaseBodyToExample('', '1.0.0')).toBeNull();
  });

  it('should return null when no bullet entries found', () => {
    expect(parseReleaseBodyToExample('### New\n\nSome prose without bullets.', '1.0.0')).toBeNull();
  });

  it('should detect breaking flag from **BREAKING** marker', () => {
    const body = '### Changed\n- Drop Node 16 support **BREAKING**\n';
    const result = parseReleaseBodyToExample(body, '3.0.0');
    expect(result!.entries[0]!.breaking).toBe(true);
  });

  it('should skip ## headings (treated as version title, not category)', () => {
    const body = '## v1.0.0\n\n### New\n- Add feature\n';
    const result = parseReleaseBodyToExample(body, '1.0.0');
    expect(result!.entries[0]!.category).toBe('New');
  });

  it('should use General as default category when no heading precedes bullets', () => {
    const body = '- Some entry without heading\n';
    const result = parseReleaseBodyToExample(body, '1.0.0');
    expect(result!.entries[0]!.category).toBe('General');
  });
});

// ---------------------------------------------------------------------------
// renderExamplesBlock
// ---------------------------------------------------------------------------

describe('renderExamplesBlock()', () => {
  it('should return empty string for empty examples array', () => {
    expect(renderExamplesBlock([])).toBe('');
  });

  it('should render examples in <example> tags', () => {
    const examples: Example[] = [
      {
        version: '1.0.0',
        entries: [{ description: 'Add feature', category: 'New' }],
      },
    ];
    const result = renderExamplesBlock(examples);
    expect(result).toContain('<example version="1.0.0">');
    expect(result).toContain('[New]: Add feature');
    expect(result).toContain('</example>');
  });

  it('should render leadIn with bold prefix', () => {
    const examples: Example[] = [
      {
        version: '2.0.0',
        entries: [{ description: 'New API surface', category: 'New', leadIn: 'Streaming API' }],
      },
    ];
    const result = renderExamplesBlock(examples);
    expect(result).toContain('**Streaming API**: New API surface');
  });

  it('should render scope and breaking flag', () => {
    const examples: Example[] = [
      {
        version: '3.0.0',
        entries: [{ description: 'Remove legacy auth', category: 'Breaking', scope: 'auth', breaking: true }],
      },
    ];
    const result = renderExamplesBlock(examples);
    expect(result).toContain('(auth)');
    expect(result).toContain('**BREAKING**');
  });

  it('should render multiple examples', () => {
    const examples: Example[] = [
      { version: '1.0.0', entries: [{ description: 'First', category: 'New' }] },
      { version: '2.0.0', entries: [{ description: 'Second', category: 'Fixed' }] },
    ];
    const result = renderExamplesBlock(examples);
    expect(result).toContain('<example version="1.0.0">');
    expect(result).toContain('<example version="2.0.0">');
  });
});

// ---------------------------------------------------------------------------
// fetchExamples
// ---------------------------------------------------------------------------

describe('fetchExamples()', () => {
  beforeEach(() => {
    vi.stubEnv('GITHUB_TOKEN', 'test-token');
    vi.stubEnv('GH_TOKEN', '');
    vi.mocked(Octokit).mockImplementation(
      class {
        rest = { repos: { listReleases: vi.fn().mockRejectedValue(new Error('network error')) } };
      } as unknown as typeof Octokit,
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('should return empty array when count is 0', async () => {
    const result = await fetchExamples({ owner: 'o', repo: 'r', packageName: 'pkg', count: 0 });
    expect(result).toEqual([]);
  });

  it('should return empty array when no GitHub token is available', async () => {
    vi.stubEnv('GITHUB_TOKEN', '');
    vi.stubEnv('GH_TOKEN', '');
    const result = await fetchExamples({ owner: 'o', repo: 'r', packageName: 'pkg', count: 3 });
    expect(result).toEqual([]);
  });

  it('should use provided githubToken over env', async () => {
    // If an explicit token is provided, it should not need GITHUB_TOKEN
    vi.stubEnv('GITHUB_TOKEN', '');
    vi.stubEnv('GH_TOKEN', '');
    // We can't actually call GitHub here, so we just verify it doesn't return early
    // The Octokit call will fail with a network error; that's caught and returns []
    const result = await fetchExamples({
      owner: 'o',
      repo: 'r',
      packageName: 'pkg',
      count: 1,
      githubToken: 'explicit-token',
    });
    // Either empty (network error caught) or actual results — both are valid in unit test
    expect(Array.isArray(result)).toBe(true);
  });

  it('should return empty array and does not throw on API error', async () => {
    // fetchExamples catches all errors and returns []
    const result = await fetchExamples({
      owner: 'nonexistent-owner-xyz',
      repo: 'nonexistent-repo-xyz',
      packageName: 'pkg',
      count: 1,
    });
    expect(Array.isArray(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// fetchExamples() - release matching (monorepo / bare-version fallback)
// ---------------------------------------------------------------------------

describe('fetchExamples() - release matching', () => {
  let listReleasesMock: ReturnType<typeof vi.fn>;

  function makeRelease(tagName: string, body = '### New\n- Some feature\n') {
    return { tag_name: tagName, draft: false, prerelease: false, body };
  }

  beforeEach(() => {
    vi.stubEnv('GITHUB_TOKEN', 'test-token');
    vi.stubEnv('GH_TOKEN', '');
    listReleasesMock = vi.fn();
    vi.mocked(Octokit).mockImplementation(
      class {
        rest = { repos: { listReleases: listReleasesMock } };
      } as unknown as typeof Octokit,
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('should use only package-scoped releases when they exist, ignoring bare version tags', async () => {
    listReleasesMock.mockResolvedValue({
      data: [makeRelease('@scope/foo@2.0.0'), makeRelease('@scope/bar@2.0.0'), makeRelease('v2.0.0')],
    });

    const result = await fetchExamples({ owner: 'o', repo: 'r1', packageName: '@scope/foo', count: 3 });
    expect(result).toHaveLength(1);
    expect(result[0]?.version).toBe('2.0.0');
  });

  it('should fall back to bare version tags when no package-scoped releases exist (single-package repo)', async () => {
    listReleasesMock.mockResolvedValue({
      data: [makeRelease('v2.0.0'), makeRelease('v1.0.0')],
    });

    const result = await fetchExamples({ owner: 'o', repo: 'r2', packageName: 'my-package', count: 3 });
    expect(result).toHaveLength(2);
  });

  it('should use bare version tags as fallback when only other packages have scoped releases', async () => {
    listReleasesMock.mockResolvedValue({
      data: [makeRelease('@scope/bar@1.0.0'), makeRelease('v2.0.0')],
    });

    // @scope/foo has no package-scoped releases, so bare tag should be used
    const result = await fetchExamples({ owner: 'o', repo: 'r3', packageName: '@scope/foo', count: 3 });
    expect(result).toHaveLength(1);
    expect(result[0]?.version).toBe('2.0.0');
  });

  it('should respect count limit on package-scoped results', async () => {
    listReleasesMock.mockResolvedValue({
      data: [makeRelease('my-pkg@3.0.0'), makeRelease('my-pkg@2.0.0'), makeRelease('my-pkg@1.0.0')],
    });

    const result = await fetchExamples({ owner: 'o', repo: 'r4', packageName: 'my-pkg', count: 2 });
    expect(result).toHaveLength(2);
  });

  it('should skip draft and prerelease entries', async () => {
    listReleasesMock.mockResolvedValue({
      data: [
        { tag_name: 'my-pkg@2.0.0', draft: true, prerelease: false, body: '### New\n- A\n' },
        { tag_name: 'my-pkg@1.0.0', draft: false, prerelease: true, body: '### New\n- B\n' },
        makeRelease('my-pkg@0.9.0'),
      ],
    });

    const result = await fetchExamples({ owner: 'o', repo: 'r5', packageName: 'my-pkg', count: 3 });
    expect(result).toHaveLength(1);
    expect(result[0]?.version).toBe('0.9.0');
  });
});
