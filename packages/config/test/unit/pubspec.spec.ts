import { describe, expect, it } from 'vitest';
import { isPubspecReleasable, isPubspecYaml, type PubspecManifest, parsePubspec } from '../../src/pubspec.js';

describe('parsePubspec', () => {
  it('should parse name, version and publish_to from content', () => {
    const result = parsePubspec('pubspec.yaml', 'name: my_pkg\nversion: 1.2.3\npublish_to: none\n');
    expect(result).toMatchObject({ name: 'my_pkg', version: '1.2.3', publish_to: 'none' });
  });

  it('should return an empty manifest for an empty document', () => {
    expect(parsePubspec('pubspec.yaml', '')).toEqual({});
  });

  it('should return an empty manifest for a comment-only document', () => {
    expect(parsePubspec('pubspec.yaml', '# just a comment\n')).toEqual({});
  });
});

describe('isPubspecReleasable', () => {
  it.each([
    ['a named, versioned package', { name: 'pkg', version: '1.0.0' }, true],
    ['a Dart workspace root', { name: 'workspace', workspace: ['packages/a'] }, false],
    ['a publish_to: none package', { name: 'app', version: '1.0.0+7', publish_to: 'none' }, false],
    ['a numeric version', { name: 'pkg', version: 1.0 }, false],
  ])('should treat %s as releasable: %s', (_label, manifest, expected) => {
    expect(isPubspecReleasable(manifest as PubspecManifest)).toBe(expected);
  });
});

describe('isPubspecYaml', () => {
  it('should return true for pubspec.yaml paths', () => {
    expect(isPubspecYaml('pubspec.yaml')).toBe(true);
    expect(isPubspecYaml('/a/b/pubspec.yaml')).toBe(true);
  });

  it('should return false for other files', () => {
    expect(isPubspecYaml('package.json')).toBe(false);
    expect(isPubspecYaml('pubspec.yml')).toBe(false);
  });
});
