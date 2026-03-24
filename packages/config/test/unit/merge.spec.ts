import { describe, expect, it } from 'vitest';
import { deepMerge, mergeGitConfig } from '../../src/merge.js';
import type { GitConfig, PublishGitConfig } from '../../src/schema.js';

describe('mergeGitConfig', () => {
  it('should return undefined when both inputs are undefined', () => {
    const result = mergeGitConfig(undefined, undefined);
    expect(result).toBeUndefined();
  });

  it('should return topLevel when packageLevel is undefined', () => {
    const topLevel: GitConfig = {
      remote: 'upstream',
      branch: 'develop',
      pushMethod: 'ssh',
    };
    const result = mergeGitConfig(topLevel, undefined);
    expect(result?.remote).toBe('upstream');
    expect(result?.branch).toBe('develop');
    expect(result?.pushMethod).toBe('ssh');
  });

  it('should return packageLevel with topLevel defaults when topLevel is undefined', () => {
    const result = mergeGitConfig(undefined, { remote: 'origin' } as PublishGitConfig);
    expect(result?.remote).toBe('origin');
    expect(result?.branch).toBe('main');
    expect(result?.pushMethod).toBe('auto');
  });

  it('merges packageLevel over topLevel', () => {
    const topLevel: GitConfig = {
      remote: 'origin',
      branch: 'main',
      pushMethod: 'auto',
    };
    const packageLevel = {
      remote: 'upstream',
      branch: 'develop',
    } as PublishGitConfig;

    const result = mergeGitConfig(topLevel, packageLevel);
    expect(result?.remote).toBe('upstream');
    expect(result?.branch).toBe('develop');
    expect(result?.pushMethod).toBe('auto');
  });

  it('should preserve topLevel values when packageLevel does not override', () => {
    const topLevel: GitConfig = {
      remote: 'origin',
      branch: 'main',
      pushMethod: 'ssh',
    };
    const packageLevel: PublishGitConfig = {
      push: false,
    };

    const result = mergeGitConfig(topLevel, packageLevel);
    expect(result?.remote).toBe('origin');
    expect(result?.branch).toBe('main');
    expect(result?.pushMethod).toBe('ssh');
    expect(result?.push).toBe(false);
  });

  it('should include push from packageLevel', () => {
    const result = mergeGitConfig(undefined, { push: false });
    expect(result?.push).toBe(false);
  });

  it('inherits skipHooks from topLevel', () => {
    const topLevel: GitConfig = {
      remote: 'origin',
      branch: 'main',
      pushMethod: 'auto',
      skipHooks: true,
    };
    const result = mergeGitConfig(topLevel, {});
    expect(result?.skipHooks).toBe(true);
  });

  it('overrides skipHooks from packageLevel', () => {
    const topLevel: GitConfig = {
      remote: 'origin',
      branch: 'main',
      pushMethod: 'auto',
      skipHooks: true,
    };
    const result = mergeGitConfig(topLevel, { skipHooks: false });
    expect(result?.skipHooks).toBe(false);
  });
});

describe('deepMerge', () => {
  it('should return undefined when both inputs are undefined', () => {
    const result = deepMerge(undefined, undefined);
    expect(result).toBeUndefined();
  });

  it('should return source when target is undefined', () => {
    const result = deepMerge(undefined, { a: 1 });
    expect(result).toEqual({ a: 1 });
  });

  it('should return target when source is undefined', () => {
    const result = deepMerge({ a: 1 }, undefined);
    expect(result).toEqual({ a: 1 });
  });

  it('merges shallow properties', () => {
    const target = { a: 1, b: 2 };
    const source = { b: 3, c: 4 };
    const result = deepMerge(target, source);
    expect(result).toEqual({ a: 1, b: 3, c: 4 });
  });

  it('merges nested objects recursively', () => {
    const target = {
      level1: {
        a: 1,
        b: 2,
      },
    } as Record<string, unknown>;
    const source = {
      level1: {
        b: 3,
        c: 4,
      },
    } as Record<string, unknown>;
    const result = deepMerge(target, source);
    expect(result).toEqual({
      level1: {
        a: 1,
        b: 3,
        c: 4,
      },
    });
  });

  it('replaces arrays instead of merging', () => {
    const target = { arr: [1, 2, 3] };
    const source = { arr: [4, 5] };
    const result = deepMerge(target, source);
    expect(result).toEqual({ arr: [4, 5] });
  });

  it('should set null values from source', () => {
    const target = { a: 1, b: 2 };
    const source = { a: null, c: 3 } as Record<string, unknown>;
    const result = deepMerge(target, source);
    expect(result).toEqual({ a: null, b: 2, c: 3 });
  });

  it('should preserve null values in target when source does not override', () => {
    const target = { a: null } as Record<string, unknown>;
    const source = { b: 2 };
    const result = deepMerge(target, source);
    expect(result).toEqual({ a: null, b: 2 });
  });

  it('should handle deeply nested structures', () => {
    const target = {
      a: {
        b: {
          c: {
            d: 1,
          },
        },
      },
    } as Record<string, unknown>;
    const source = {
      a: {
        b: {
          c: {
            e: 2,
          },
        },
      },
    } as Record<string, unknown>;
    const result = deepMerge(target, source);
    expect(result).toEqual({
      a: {
        b: {
          c: {
            d: 1,
            e: 2,
          },
        },
      },
    });
  });

  it('does not mutate target', () => {
    const target = { a: { b: 1 } } as Record<string, unknown>;
    const source = { a: { c: 2 } } as Record<string, unknown>;
    deepMerge(target, source);
    expect(target).toEqual({ a: { b: 1 } });
  });

  it('should handle primitive values in source', () => {
    const target = { a: { nested: true } } as Record<string, unknown>;
    const source = { a: 'string' };
    const result = deepMerge(target, source);
    expect(result).toEqual({ a: 'string' });
  });

  it('should handle primitive values in target when source has object', () => {
    const target = { a: 'string' };
    const source = { a: { nested: true } } as Record<string, unknown>;
    const result = deepMerge(target, source);
    expect(result).toEqual({ a: { nested: true } });
  });
});
