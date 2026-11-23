import { describe, expect, it } from 'vitest';
import { formatReleaseCommitMessage } from '../../../src/utils/commitMessage.js';

describe('formatReleaseCommitMessage', () => {
  const a = { name: 'a', version: '1.0.0' };
  const b = { name: 'b', version: '2.0.0' };

  it.each([
    ['names and a shared version', 'chore: release', [a, { ...b, version: '1.0.0' }], 'chore: release a, b v1.0.0'],
    ['each name@version when versions differ', 'chore: release', [a, b], 'chore: release a@1.0.0, b@2.0.0'],
    ['placeholders, with the first version', 'release ${packageName} ${version}', [a, b], 'release a, b 1.0.0'],
  ])('should fill in %s', (_case, template, released, expected) => {
    expect(formatReleaseCommitMessage(template, released, { versionPrefix: 'v' })).toBe(expected);
  });

  it('should close the gap an empty ${packageName} leaves', () => {
    const message = formatReleaseCommitMessage('chore: release ${packageName} v${version}', [], {
      versionPrefix: 'v',
      version: '1.0.0',
    });

    expect(message).toBe('chore: release v1.0.0');
  });
});
