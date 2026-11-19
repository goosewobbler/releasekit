import { describe, expect, it } from 'vitest';
import { renderChangelogBlock, sharedPackageEntriesOf } from '../../src/changelogBlock.js';

describe('renderChangelogBlock', () => {
  it("should put the entries' sections one level under the heading, Breaking first", () => {
    const entries = [
      { type: 'fix', description: 'Fix A' },
      { type: 'feat', description: 'Drop B', breaking: true },
    ];

    expect(renderChangelogBlock('Project-wide changes', 3, entries, 'link', null)).toBe(
      '### Project-wide changes\n\n#### Breaking\n\n- Drop B\n\n#### Fixed\n\n- Fix A',
    );
  });
});

describe('sharedPackageEntriesOf', () => {
  const fix = { type: 'fix', description: 'Fix core', sharedPackage: true };

  it("should take a changelog's recorded shared-package entries over the run's", () => {
    expect(sharedPackageEntriesOf({ entries: [], sharedPackageEntries: [] }, [fix])).toEqual([]);
  });

  it('should pick from the run when an older manifest records none, leaving out what the package lists itself', () => {
    const listed = { type: 'fix', description: 'Fix listed', sharedPackage: true };
    const repoLevel = { type: 'ci', description: 'Pin runner' };

    expect(
      sharedPackageEntriesOf({ entries: [{ type: 'fix', description: 'Fix listed' }] }, [fix, listed, repoLevel]),
    ).toEqual([fix]);
  });
});
