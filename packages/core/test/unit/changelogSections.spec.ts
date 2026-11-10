import { describe, expect, it } from 'vitest';
import { groupChangelogSections } from '../../src/index.js';

interface Entry {
  type: string;
  description: string;
  breaking?: boolean;
}

function labelsAndDescriptions(entries: Entry[], labelOrder?: string[]): [string, string[]][] {
  return groupChangelogSections(entries, (e) => e, labelOrder).map((s) => [s.label, s.items.map((e) => e.description)]);
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

  it('should follow labelOrder, then any other label in first-seen order', () => {
    expect(
      labelsAndDescriptions(
        [
          { type: 'wip', description: 'Unknown' },
          { type: 'fixed', description: 'Fix' },
          { type: 'changed', description: 'Change' },
        ],
        ['Changed', 'Fixed'],
      ),
    ).toEqual([
      ['Changed', ['Change']],
      ['Fixed', ['Fix']],
      ['Wip', ['Unknown']],
    ]);
  });

  it('should omit the Breaking section when nothing is breaking', () => {
    expect(labelsAndDescriptions([{ type: 'fix', description: 'Fix' }])).toEqual([['Fixed', ['Fix']]]);
  });
});
