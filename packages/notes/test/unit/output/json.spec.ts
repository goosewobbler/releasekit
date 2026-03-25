import { describe, expect, it } from 'vitest';
import type { TemplateContext } from '../../../src/core/types.js';
import { renderJson } from '../../../src/output/json.js';

function makeContext(overrides: Partial<TemplateContext> = {}): TemplateContext {
  return {
    packageName: 'pkg',
    version: '1.0.0',
    previousVersion: null,
    date: '2024-01-15',
    entries: [],
    repoUrl: null,
    ...overrides,
  };
}

describe('renderJson', () => {
  it('should render single context as JSON', () => {
    const contexts: TemplateContext[] = [
      makeContext({
        packageName: '@scope/my-package',
        version: '2.0.0',
        previousVersion: '1.0.0',
        entries: [
          { type: 'added', description: 'New feature' },
          { type: 'fixed', description: 'Bug fix' },
        ],
        compareUrl: 'https://github.com/owner/repo/compare/v1.0.0...v2.0.0',
      }),
    ];

    const result = renderJson(contexts);
    const parsed = JSON.parse(result);

    expect(parsed.versions).toHaveLength(1);
    expect(parsed.versions[0].packageName).toBe('@scope/my-package');
    expect(parsed.versions[0].version).toBe('2.0.0');
    expect(parsed.versions[0].entries).toHaveLength(2);
  });

  it('should render multiple contexts', () => {
    const contexts: TemplateContext[] = [
      makeContext({ packageName: 'pkg-a', version: '1.0.0' }),
      makeContext({ packageName: 'pkg-b', version: '2.0.0', previousVersion: '1.0.0' }),
    ];

    const result = renderJson(contexts);
    const parsed = JSON.parse(result);

    expect(parsed.versions).toHaveLength(2);
  });

  it('should include all entry fields', () => {
    const contexts: TemplateContext[] = [
      makeContext({
        entries: [
          {
            type: 'added',
            description: 'Feature',
            scope: 'api',
            issueIds: ['#123'],
            breaking: true,
            originalType: 'feat',
          },
        ],
      }),
    ];

    const result = renderJson(contexts);
    const parsed = JSON.parse(result);

    const entry = parsed.versions[0].entries[0];
    expect(entry.type).toBe('added');
    expect(entry.scope).toBe('api');
    expect(entry.issueIds).toEqual(['#123']);
    expect(entry.breaking).toBe(true);
    expect(entry.originalType).toBe('feat');
  });

  it('should handle empty contexts array', () => {
    const result = renderJson([]);
    const parsed = JSON.parse(result);

    expect(parsed.versions).toEqual([]);
  });

  it('should format JSON with indentation', () => {
    const contexts: TemplateContext[] = [makeContext()];

    const result = renderJson(contexts);

    expect(result).toContain('\n');
    expect(result).toContain('  ');
  });

  it('should include compareUrl when present', () => {
    const contexts: TemplateContext[] = [
      makeContext({
        compareUrl: 'https://github.com/owner/repo/compare/v0.9.0...v1.0.0',
      }),
    ];

    const result = renderJson(contexts);
    const parsed = JSON.parse(result);

    expect(parsed.versions[0].compareUrl).toBe('https://github.com/owner/repo/compare/v0.9.0...v1.0.0');
  });

  it('should handle null previousVersion', () => {
    const contexts: TemplateContext[] = [makeContext()];

    const result = renderJson(contexts);
    const parsed = JSON.parse(result);

    expect(parsed.versions[0].previousVersion).toBeNull();
  });
});
