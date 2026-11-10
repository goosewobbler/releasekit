import { describe, expect, it } from 'vitest';
import { breakingFirst, groupChangelogSections } from '../../src/index.js';

interface Entry {
  type: string;
  description: string;
  scope?: string;
  breaking?: boolean;
}

function labelsAndDescriptions(
  entries: Entry[],
  opts?: Parameters<typeof groupChangelogSections>[2],
): [string, string[]][] {
  return groupChangelogSections(entries, (e) => e, opts).map((s) => [s.label, s.items.map((e) => e.description)]);
}

describe('groupChangelogSections', () => {
  it('should lead with breaking entries, out of their type group', () => {
    expect(
      labelsAndDescriptions([
        { type: 'fix', description: 'Patch serializer' },
        { type: 'feat', description: 'New flag' },
        { type: 'fix', description: 'Reject old preset', breaking: true },
        { type: 'feat', description: 'Drop node 18', breaking: true },
      ]),
    ).toEqual([
      ['Breaking', ['Reject old preset', 'Drop node 18']],
      ['Added', ['New flag']],
      ['Fixed', ['Patch serializer']],
    ]);
  });

  it('should fold conventional and keep-a-changelog types onto one label', () => {
    expect(
      labelsAndDescriptions([
        { type: 'feat', description: 'A' },
        { type: 'added', description: 'B' },
      ]),
    ).toEqual([['Added', ['A', 'B']]]);
  });

  it('should order Keep a Changelog sections first, then other known labels, then unknown ones as first seen', () => {
    expect(
      labelsAndDescriptions(
        ['wip', 'perf', 'security', 'fix', 'removed', 'deprecated', 'changed', 'feat'].map((type) => ({
          type,
          description: type,
        })),
      ).map(([label]) => label),
    ).toEqual(['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security', 'Performance', 'Wip']);
  });

  it('should omit the Breaking section when nothing is breaking', () => {
    expect(labelsAndDescriptions([{ type: 'fix', description: 'Fix' }])).toEqual([['Fixed', ['Fix']]]);
  });

  it('should label a type named after an Object.prototype member by capitalising it', () => {
    expect(labelsAndDescriptions([{ type: 'constructor', description: 'Tidy init' }])).toEqual([
      ['Constructor', ['Tidy init']],
    ]);
  });

  it('should move non-breaking entries in a demoted scope to a trailing section, keeping breaking ones first', () => {
    expect(
      labelsAndDescriptions(
        [
          { type: 'changed', description: 'Bump lodash', scope: 'deps' },
          { type: 'fix', description: 'Fix', scope: 'cli' },
          { type: 'changed', description: 'Require node 22', scope: 'deps', breaking: true },
        ],
        { demoteScopes: ['deps'] },
      ),
    ).toEqual([
      ['Breaking', ['Require node 22']],
      ['Fixed', ['Fix']],
      ['Dependencies & version bumps', ['Bump lodash']],
    ]);
  });
});

describe('breakingFirst', () => {
  it('should put breaking entries first and keep the original order otherwise', () => {
    const entries = [
      { description: 'a' },
      { description: 'b', breaking: true },
      { description: 'c' },
      { description: 'd', breaking: true },
    ];
    expect(breakingFirst(entries).map((e) => e.description)).toEqual(['b', 'd', 'a', 'c']);
  });
});
