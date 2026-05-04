import { describe, expect, it } from 'vitest';
import type { ChangelogEntry, LLMCategory, ScopeConfig } from '../../src/core/types.js';
import {
  getAllowedScopesFromCategories,
  resolveAllowedScopes,
  validateEntryScopes,
  validateScope,
} from '../../src/llm/scopes.js';

// ---------------------------------------------------------------------------
// getAllowedScopesFromCategories
// ---------------------------------------------------------------------------

describe('getAllowedScopesFromCategories()', () => {
  it('should return scopes from explicit scopes arrays', () => {
    const categories: LLMCategory[] = [
      { name: 'Developer', description: 'Internal changes', scopes: ['CI', 'Dependencies', 'Testing'] },
      { name: 'New', description: 'New features' },
    ];
    const result = getAllowedScopesFromCategories(categories);
    expect(result.size).toBe(1);
    expect(result.get('Developer')).toEqual(['CI', 'Dependencies', 'Testing']);
  });

  it('should return empty map when no categories have scopes', () => {
    const categories: LLMCategory[] = [
      { name: 'New', description: 'New features' },
      { name: 'Fixed', description: 'Bug fixes' },
    ];
    const result = getAllowedScopesFromCategories(categories);
    expect(result.size).toBe(0);
  });

  it('should handle multiple categories with scopes', () => {
    const categories: LLMCategory[] = [
      { name: 'Developer', description: 'Internal', scopes: ['CI', 'Dependencies'] },
      { name: 'Documentation', description: 'Docs', scopes: ['API', 'Guides'] },
    ];
    const result = getAllowedScopesFromCategories(categories);
    expect(result.size).toBe(2);
    expect(result.get('Developer')).toEqual(['CI', 'Dependencies']);
    expect(result.get('Documentation')).toEqual(['API', 'Guides']);
  });

  it('should ignore categories with empty scopes array', () => {
    const categories: LLMCategory[] = [{ name: 'Developer', description: 'Internal', scopes: [] }];
    const result = getAllowedScopesFromCategories(categories);
    expect(result.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// resolveAllowedScopes
// ---------------------------------------------------------------------------

describe('resolveAllowedScopes()', () => {
  it('should return null for undefined scopeConfig (unrestricted)', () => {
    expect(resolveAllowedScopes(undefined)).toBeNull();
  });

  it('should return null for unrestricted mode', () => {
    expect(resolveAllowedScopes({ mode: 'unrestricted' })).toBeNull();
  });

  it('should return empty array for none mode', () => {
    expect(resolveAllowedScopes({ mode: 'none' })).toEqual([]);
  });

  it('should return package names for packages mode', () => {
    const result = resolveAllowedScopes({ mode: 'packages' }, undefined, ['@acme/core', '@acme/ui']);
    expect(result).toEqual(['@acme/core', '@acme/ui']);
  });

  it('should return empty array for packages mode without package names', () => {
    expect(resolveAllowedScopes({ mode: 'packages' })).toEqual([]);
  });

  it('should return explicit allowed scopes for restricted mode', () => {
    const config: ScopeConfig = {
      mode: 'restricted',
      rules: { allowed: ['CI', 'Dependencies'] },
    };
    const result = resolveAllowedScopes(config);
    expect(result).toEqual(['CI', 'Dependencies']);
  });

  it('should merge explicit and category scopes for restricted mode', () => {
    const config: ScopeConfig = {
      mode: 'restricted',
      rules: { allowed: ['Security'] },
    };
    const categories: LLMCategory[] = [{ name: 'Developer', description: 'Internal', scopes: ['CI', 'Dependencies'] }];
    const result = resolveAllowedScopes(config, categories);
    expect(result).toContain('Security');
    expect(result).toContain('CI');
    expect(result).toContain('Dependencies');
    expect(result).toHaveLength(3);
  });

  it('should deduplicate scopes across config and categories', () => {
    const config: ScopeConfig = {
      mode: 'restricted',
      rules: { allowed: ['CI', 'Testing'] },
    };
    const categories: LLMCategory[] = [{ name: 'Developer', description: 'Internal', scopes: ['CI', 'Dependencies'] }];
    const result = resolveAllowedScopes(config, categories);
    expect(result).toEqual(['CI', 'Testing', 'Dependencies']);
  });

  it('should return empty explicit list when restricted with no rules', () => {
    const result = resolveAllowedScopes({ mode: 'restricted' });
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// validateScope
// ---------------------------------------------------------------------------

describe('validateScope()', () => {
  it('should return scope unchanged when allowedScopes is null (unrestricted)', () => {
    expect(validateScope('anything', null)).toBe('anything');
  });

  it('should return undefined when scope is undefined', () => {
    expect(validateScope(undefined, ['CI'])).toBeUndefined();
  });

  it('should return undefined when allowedScopes is empty (none mode)', () => {
    expect(validateScope('CI', [])).toBeUndefined();
  });

  it('should return scope when it matches allowed list', () => {
    expect(validateScope('CI', ['CI', 'Dependencies'])).toBe('CI');
  });

  it('should be case-insensitive by default', () => {
    expect(validateScope('ci', ['CI', 'Dependencies'])).toBe('ci');
  });

  it('should be case-sensitive when configured', () => {
    expect(validateScope('ci', ['CI'], true)).toBeUndefined();
    expect(validateScope('CI', ['CI'], true)).toBe('CI');
  });

  it('should return undefined for invalid scopes (no fallback behavior)', () => {
    expect(validateScope('Invalid', ['CI', 'Dependencies'])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// validateEntryScopes
// ---------------------------------------------------------------------------

describe('validateEntryScopes()', () => {
  const entries: ChangelogEntry[] = [
    { type: 'added', description: 'Update CI', scope: 'CI' },
    { type: 'fixed', description: 'Fix deps', scope: 'InvalidScope' },
    { type: 'changed', description: 'No scope' },
  ];

  it('should return valid result when scopeConfig is undefined', () => {
    const result = validateEntryScopes(entries, undefined);
    expect(result.valid).toBe(true);
    expect(result.entries).toBe(entries);
    expect(result.errors).toHaveLength(0);
  });

  it('should return valid result for unrestricted mode', () => {
    const result = validateEntryScopes(entries, { mode: 'unrestricted' });
    expect(result.valid).toBe(true);
    expect(result.entries).toBe(entries);
    expect(result.errors).toHaveLength(0);
  });

  it('should return invalid result with all scopes stripped for none mode', () => {
    const result = validateEntryScopes(entries, { mode: 'none' });
    expect(result.valid).toBe(false);
    expect(result.entries[0]?.scope).toBeUndefined();
    expect(result.entries[1]?.scope).toBeUndefined();
    expect(result.entries[2]?.scope).toBeUndefined();
  });

  it('should validate scopes and return errors for invalid ones', () => {
    const categories: LLMCategory[] = [{ name: 'Developer', description: 'Internal', scopes: ['CI', 'Dependencies'] }];
    const result = validateEntryScopes(entries, { mode: 'restricted' }, categories);
    expect(result.valid).toBe(false);
    expect(result.entries[0]?.scope).toBe('CI'); // valid
    expect(result.entries[1]?.scope).toBeUndefined(); // InvalidScope stripped
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.providedScope).toBe('InvalidScope');
    expect(result.errors[0]?.entryIndex).toBe(1);
  });

  it('should return valid result when all scopes are valid', () => {
    const validEntries: ChangelogEntry[] = [
      { type: 'added', description: 'Update CI', scope: 'CI' },
      { type: 'changed', description: 'No scope' },
    ];
    const categories: LLMCategory[] = [{ name: 'Developer', description: 'Internal', scopes: ['CI', 'Dependencies'] }];
    const result = validateEntryScopes(validEntries, { mode: 'restricted' }, categories);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should not mutate original entries', () => {
    const result = validateEntryScopes(entries, { mode: 'none' });
    expect(entries[0]?.scope).toBe('CI'); // original unchanged
    expect(result.entries[0]?.scope).toBeUndefined(); // new copy changed
  });
});
