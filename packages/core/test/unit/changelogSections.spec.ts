import { describe, expect, it } from 'vitest';
import { groupChangelogSections } from '../../src/index.js';

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

  it('should move non-breaking deps and deps-dev entries to a trailing section, keeping breaking ones first', () => {
    expect(
      labelsAndDescriptions([
        { type: 'changed', description: 'Bump lodash', scope: 'deps' },
        { type: 'fix', description: 'Fix', scope: 'cli' },
        { type: 'chore', description: 'Bump vitest', scope: 'deps-dev' },
        { type: 'changed', description: 'Require node 22', scope: 'deps', breaking: true },
      ]),
    ).toEqual([
      ['Breaking', ['Require node 22']],
      ['Fixed', ['Fix']],
      ['Dependencies & version bumps', ['Bump lodash', 'Bump vitest']],
    ]);
  });

  describe('with categories', () => {
    const categorized = (categories: { name: string; entries: Entry[] }[], order?: string[]): [string, string[]][] =>
      labelsAndDescriptions([], { categories, order });

    it('should keep the categories and lead with breaking entries rerouted out of them', () => {
      expect(
        categorized([
          {
            name: 'Features',
            entries: [
              { type: 'feat', description: 'New flag' },
              { type: 'feat', description: 'Drop node 18', breaking: true },
            ],
          },
          { name: 'Fixes', entries: [{ type: 'fix', description: 'Reject old preset', breaking: true }] },
        ]),
      ).toEqual([
        ['Breaking', ['Drop node 18', 'Reject old preset']],
        ['Features', ['New flag']],
      ]);
    });

    it("should put rerouted entries ahead of the LLM's own Breaking category and move it first", () => {
      expect(
        categorized([
          { name: 'Features', entries: [{ type: 'feat', description: 'Rename option', breaking: true }] },
          { name: 'Breaking', entries: [{ type: 'feat', description: 'Drop node 18' }] },
        ]),
      ).toEqual([['Breaking', ['Rename option', 'Drop node 18']]]);
    });

    it('should order categories by the given order, unnamed ones after, Breaking first unless named', () => {
      const categories = ['Fixes', 'Docs', 'Features', 'Other'].map((name) => ({
        name,
        entries: [{ type: 'feat', description: name }],
      }));
      categories.push({ name: 'Misc', entries: [{ type: 'feat', description: 'Break', breaking: true }] });
      expect(categorized(categories, ['Features', 'Fixes']).map(([label]) => label)).toEqual([
        'Breaking',
        'Features',
        'Fixes',
        'Docs',
        'Other',
      ]);
      expect(categorized(categories, ['Features', 'Breaking']).map(([label]) => label)).toEqual([
        'Features',
        'Breaking',
        'Fixes',
        'Docs',
        'Other',
      ]);
    });

    it('should not demote deps entries', () => {
      expect(
        categorized([{ name: 'Maintenance', entries: [{ type: 'chore', description: 'Bump lodash', scope: 'deps' }] }]),
      ).toEqual([['Maintenance', ['Bump lodash']]]);
    });

    it('should group by type when there are no categories', () => {
      expect(labelsAndDescriptions([{ type: 'fix', description: 'Fix' }], { categories: [] })).toEqual([
        ['Fixed', ['Fix']],
      ]);
    });
  });
});
