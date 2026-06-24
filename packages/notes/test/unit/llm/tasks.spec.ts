import { describe, expect, it } from 'vitest';
import type { ChangelogEntry } from '../../../src/core/types.js';
import type { CompleteResult } from '../../../src/llm/messages.js';
import { createCategorizeValidator } from '../../../src/llm/tasks/categorize.js';
import { createEnhanceAndCategorizeValidator } from '../../../src/llm/tasks/enhance-and-categorize.js';
import { buildCategorySection, renderScopeInstruction } from '../../../src/llm/tasks/shared.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const entries: ChangelogEntry[] = [
  { type: 'added', description: 'Add streaming support' },
  { type: 'fixed', description: 'Fix null pointer in parser' },
  { type: 'changed', description: 'Refactor config loading' },
];

const ctx = { packageName: 'my-lib', version: '2.0.0', previousVersion: '1.0.0' };

/** Wraps a structured payload as a CompleteResult (structured-output path). */
function structured(value: unknown): CompleteResult {
  return { content: JSON.stringify(value), structured: value };
}

// ---------------------------------------------------------------------------
// createCategorizeValidator
// ---------------------------------------------------------------------------

describe('createCategorizeValidator()', () => {
  it('should validate a well-formed response and group entries by category', () => {
    const validate = createCategorizeValidator(entries, ctx);
    const result = validate(
      structured({
        entries: [
          { category: 'New Features', scope: null },
          { category: 'Bug Fixes', scope: null },
          { category: 'Bug Fixes', scope: null },
        ],
      }),
    );

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value).toHaveLength(2);
    expect(result.value.find((c) => c.category === 'New Features')?.entries).toHaveLength(1);
    expect(result.value.find((c) => c.category === 'Bug Fixes')?.entries).toHaveLength(2);
  });

  it('should reject malformed JSON with an Invalid JSON error', () => {
    const validate = createCategorizeValidator(entries, ctx);
    const result = validate({ content: 'not json', structured: undefined });

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.error).toContain('Invalid JSON');
  });

  it('should reject a response whose entry count does not match the input', () => {
    const validate = createCategorizeValidator(entries, ctx);
    const result = validate(structured({ entries: [{ category: 'New', scope: null }] }));

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.error).toBe('Expected 3 entries, got 1');
  });

  it('should reject categories outside the configured list', () => {
    const validate = createCategorizeValidator(entries, {
      ...ctx,
      categories: [
        { name: 'New Features', description: 'New things' },
        { name: 'Bug Fixes', description: 'Fixes' },
      ],
    });
    const result = validate(
      structured({
        entries: [
          { category: 'New Features', scope: null },
          { category: 'Mystery', scope: null },
          { category: 'Bug Fixes', scope: null },
        ],
      }),
    );

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.error).toBe('Unknown categories: Mystery. Valid categories: New Features, Bug Fixes');
  });

  it('should apply scopes from the LLM response', () => {
    const validate = createCategorizeValidator(
      [
        { type: 'added', description: 'Update deps' },
        { type: 'fixed', description: 'Fix bug' },
      ],
      {
        ...ctx,
        categories: [{ name: 'Developer', description: 'Internal', scopes: ['Dependencies', 'CI'] }],
      },
    );
    const result = validate(
      structured({
        entries: [
          { category: 'Developer', scope: 'Dependencies' },
          { category: 'Developer', scope: null },
        ],
      }),
    );

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const dev = result.value.find((c) => c.category === 'Developer');
    expect(dev?.entries[0]?.scope).toBe('Dependencies');
    expect(dev?.entries[1]?.scope).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// createEnhanceAndCategorizeValidator
// ---------------------------------------------------------------------------

describe('createEnhanceAndCategorizeValidator()', () => {
  function fullEntry(description: string, category: string, scope: string | null = null) {
    return { description, category, scope, breaking: null, leadIn: null };
  }

  it('should validate a well-formed response into enhanced entries and categories', () => {
    const validate = createEnhanceAndCategorizeValidator(entries, ctx);
    const result = validate(
      structured({
        entries: [
          fullEntry('Added real-time streaming to the API', 'New'),
          fullEntry('Fixed null pointer in parser', 'Fixed'),
          {
            description: 'Refactored config loading',
            category: 'Developer',
            scope: 'Code Quality',
            breaking: null,
            leadIn: null,
          },
        ],
      }),
    );

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value.enhancedEntries).toHaveLength(3);
    expect(result.value.enhancedEntries[0]?.description).toBe('Added real-time streaming to the API');
    expect(result.value.enhancedEntries[2]?.scope).toBe('Code Quality');
    expect(result.value.categories).toHaveLength(3);
  });

  it('should reject malformed JSON with an Invalid JSON error', () => {
    const validate = createEnhanceAndCategorizeValidator(entries, ctx);
    const result = validate({ content: 'not json', structured: undefined });

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.error).toContain('Invalid JSON');
  });

  it('should reject a response with fewer entries than the input', () => {
    const validate = createEnhanceAndCategorizeValidator(entries, ctx);
    const result = validate(structured({ entries: [fullEntry('Only first', 'New')] }));

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.error).toBe('Expected 3 entries, got 1 (entries missing — cannot proceed)');
  });

  it('should truncate and still validate when the response has more entries than the input', () => {
    const validate = createEnhanceAndCategorizeValidator(entries, ctx);
    const result = validate(
      structured({
        entries: [
          fullEntry('Enhanced A', 'New'),
          fullEntry('Enhanced B', 'Fixed'),
          fullEntry('Enhanced C', 'Changed'),
          fullEntry('Spurious extra', 'New'),
          fullEntry('Another extra', 'Fixed'),
        ],
      }),
    );

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value.enhancedEntries).toHaveLength(3);
    expect(result.value.enhancedEntries[2]?.description).toBe('Enhanced C');
  });

  it('should reject categories outside the configured list', () => {
    const validate = createEnhanceAndCategorizeValidator(entries, {
      ...ctx,
      categories: [
        { name: 'New', description: 'New things' },
        { name: 'Fixed', description: 'Fixes' },
        { name: 'Changed', description: 'Changes' },
      ],
    });
    const result = validate(
      structured({
        entries: [fullEntry('a', 'New'), fullEntry('b', 'Mystery'), fullEntry('c', 'Changed')],
      }),
    );

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.error).toBe('Unknown categories: Mystery. Valid categories: New, Fixed, Changed');
  });
});

// ---------------------------------------------------------------------------
// buildCategorySection
// ---------------------------------------------------------------------------

describe('buildCategorySection()', () => {
  it('should return the fallback when no categories are configured', () => {
    expect(buildCategorySection(undefined, 'FALLBACK')).toBe('FALLBACK');
    expect(buildCategorySection([], 'FALLBACK')).toBe('FALLBACK');
  });

  it('should render the exact category list with allowed scopes', () => {
    const section = buildCategorySection(
      [
        { name: 'New', description: 'New features' },
        { name: 'Developer', description: 'Internal changes', scopes: ['CI', 'Deps'] },
      ],
      'FALLBACK',
    );

    expect(section).toBe(
      'Categories (use ONLY these exact names):\n- "New": New features\n- "Developer": Internal changes Allowed scopes: CI, Deps.',
    );
  });
});

// ---------------------------------------------------------------------------
// renderScopeInstruction
// ---------------------------------------------------------------------------

describe('renderScopeInstruction()', () => {
  it('should return an empty string when there are no pairs', () => {
    expect(renderScopeInstruction([], '')).toBe('');
    expect(renderScopeInstruction([], ' entries')).toBe('');
  });

  it('should render the categorize wording (no entrySuffix)', () => {
    const out = renderScopeInstruction([{ name: 'Developer', scopes: ['CI', 'Deps'] }], '');
    expect(out).toBe(
      '\nFor "Developer", use a scope from: CI, Deps.\nOnly use scopes from these predefined lists. Set scope to null if no scope applies.',
    );
  });

  it('should render the enhance wording with the " entries" suffix', () => {
    const out = renderScopeInstruction([{ name: 'Developer', scopes: ['CI', 'Deps'] }], ' entries');
    expect(out).toBe(
      '\nFor "Developer" entries, use a scope from: CI, Deps.\nOnly use scopes from these predefined lists. Set scope to null if no scope applies.',
    );
  });
});
