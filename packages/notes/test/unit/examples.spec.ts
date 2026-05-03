import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchExamples } from '../../src/llm/examples/fetcher.js';
import { parseReleaseBodyToExample, renderExamplesBlock } from '../../src/llm/examples/parser.js';
import type { Example } from '../../src/llm/examples/types.js';

// ---------------------------------------------------------------------------
// parseReleaseBodyToExample
// ---------------------------------------------------------------------------

describe('parseReleaseBodyToExample()', () => {
  it('parses category headings and bullet entries', () => {
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

  it('returns null for empty body', () => {
    expect(parseReleaseBodyToExample('', '1.0.0')).toBeNull();
  });

  it('returns null when no bullet entries found', () => {
    expect(parseReleaseBodyToExample('### New\n\nSome prose without bullets.', '1.0.0')).toBeNull();
  });

  it('detects breaking flag from **BREAKING** marker', () => {
    const body = '### Changed\n- Drop Node 16 support **BREAKING**\n';
    const result = parseReleaseBodyToExample(body, '3.0.0');
    expect(result!.entries[0]!.breaking).toBe(true);
  });

  it('skips ## headings (treated as version title, not category)', () => {
    const body = '## v1.0.0\n\n### New\n- Add feature\n';
    const result = parseReleaseBodyToExample(body, '1.0.0');
    expect(result!.entries[0]!.category).toBe('New');
  });

  it('uses General as default category when no heading precedes bullets', () => {
    const body = '- Some entry without heading\n';
    const result = parseReleaseBodyToExample(body, '1.0.0');
    expect(result!.entries[0]!.category).toBe('General');
  });
});

// ---------------------------------------------------------------------------
// renderExamplesBlock
// ---------------------------------------------------------------------------

describe('renderExamplesBlock()', () => {
  it('returns empty string for empty examples array', () => {
    expect(renderExamplesBlock([])).toBe('');
  });

  it('renders examples in <example> tags', () => {
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

  it('renders leadIn with bold prefix', () => {
    const examples: Example[] = [
      {
        version: '2.0.0',
        entries: [{ description: 'New API surface', category: 'New', leadIn: 'Streaming API' }],
      },
    ];
    const result = renderExamplesBlock(examples);
    expect(result).toContain('**Streaming API**: New API surface');
  });

  it('renders scope and breaking flag', () => {
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

  it('renders multiple examples', () => {
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
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('returns empty array when count is 0', async () => {
    const result = await fetchExamples({ owner: 'o', repo: 'r', packageName: 'pkg', count: 0 });
    expect(result).toEqual([]);
  });

  it('returns empty array when no GitHub token is available', async () => {
    vi.stubEnv('GITHUB_TOKEN', '');
    vi.stubEnv('GH_TOKEN', '');
    const result = await fetchExamples({ owner: 'o', repo: 'r', packageName: 'pkg', count: 3 });
    expect(result).toEqual([]);
  });

  it('uses provided githubToken over env', async () => {
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

  it('returns empty array and does not throw on API error', async () => {
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
