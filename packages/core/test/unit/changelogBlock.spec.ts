import { describe, expect, it } from 'vitest';
import { renderChangelogBlock, sharedPackageEntriesFor } from '../../src/changelogBlock.js';

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

describe('sharedPackageEntriesFor', () => {
  it("should keep the shared-package entries a package doesn't list itself", () => {
    const shared = [
      { type: 'fix', description: 'Fix core', sharedPackage: true },
      { type: 'fix', description: 'Fix listed', sharedPackage: true },
      { type: 'ci', description: 'Pin runner' },
    ];

    expect(sharedPackageEntriesFor(shared, [{ type: 'fix', description: 'Fix listed' }])).toEqual([shared[0]]);
  });
});
