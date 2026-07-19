import { describe, expect, it } from 'vitest';
import { deriveReleaseChannel } from '../../src/types.js';

describe('deriveReleaseChannel', () => {
  it('should classify clean semver as the stable channel', () => {
    expect(deriveReleaseChannel('1.0.0')).toBe('stable');
    expect(deriveReleaseChannel('10.2.0')).toBe('stable');
    expect(deriveReleaseChannel('0.1.0')).toBe('stable');
  });

  it('should classify a prerelease version as the prerelease channel', () => {
    expect(deriveReleaseChannel('1.0.0-next.1')).toBe('prerelease');
    expect(deriveReleaseChannel('2.0.0-beta.0')).toBe('prerelease');
    expect(deriveReleaseChannel('1.0.0-0')).toBe('prerelease');
  });

  it('should ignore build metadata when deriving the channel', () => {
    // A `+build` segment is not a prerelease — only the hyphen-introduced segment is.
    expect(deriveReleaseChannel('1.0.0+build.5')).toBe('stable');
    expect(deriveReleaseChannel('1.0.0-next.1+build.5')).toBe('prerelease');
  });
});
