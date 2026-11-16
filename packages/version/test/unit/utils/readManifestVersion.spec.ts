import { describe, expect, it } from 'vitest';
import { readManifestVersion } from '../../../src/index.js';

describe('readManifestVersion with content', () => {
  it('should parse the given content for each manifest type without reading the path', () => {
    expect(readManifestVersion('/missing/package.json', '{"name":"a","version":"1.2.3"}')).toBe('1.2.3');
    expect(readManifestVersion('/missing/Cargo.toml', '[package]\nname = "a"\nversion = "2.0.0"\n')).toBe('2.0.0');
    expect(readManifestVersion('/missing/pubspec.yaml', 'name: a\nversion: 3.1.0\n')).toBe('3.1.0');
  });
});
