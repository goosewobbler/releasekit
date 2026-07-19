import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPathWithinRoot } from '../../src/paths.js';

const root = path.resolve('/repo');

describe('isPathWithinRoot', () => {
  it('should treat the root itself as within the root', () => {
    expect(isPathWithinRoot(root, root)).toBe(true);
  });

  it('should accept a direct child of the root', () => {
    expect(isPathWithinRoot(root, path.join(root, 'packages', 'foo', 'Cargo.toml'))).toBe(true);
  });

  it('should accept a relative path that resolves inside the root', () => {
    expect(isPathWithinRoot(root, path.join(root, 'packages', '..', 'crates', 'foo'))).toBe(true);
  });

  it('should reject a parent-directory escape', () => {
    expect(isPathWithinRoot(root, path.join(root, '..', 'other-repo', 'crate'))).toBe(false);
  });

  it('should reject a deeply nested escape that climbs above the root', () => {
    expect(isPathWithinRoot(root, path.join(root, 'packages', 'foo', '..', '..', '..', 'secrets'))).toBe(false);
  });

  it('should reject the root parent directory', () => {
    expect(isPathWithinRoot(root, path.dirname(root))).toBe(false);
  });

  it('should reject an absolute path outside the root', () => {
    expect(isPathWithinRoot(root, path.resolve('/etc/passwd'))).toBe(false);
  });

  it('should accept a sibling whose name merely starts with the escape sequence', () => {
    // A child literally named "..foo" is inside the root — it must not be mistaken for a `..` escape.
    expect(isPathWithinRoot(root, path.join(root, '..foo'))).toBe(true);
  });

  it('should reject a sibling directory sharing the root name prefix', () => {
    // "/repo-evil" shares the "/repo" prefix as a string but is not nested within "/repo".
    expect(isPathWithinRoot(root, path.resolve('/repo-evil', 'crate'))).toBe(false);
  });
});
