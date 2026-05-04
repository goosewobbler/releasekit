import { describe, expect, it } from 'vitest';
import { buildOrderedCategories } from '../../../src/core/pipeline.js';

describe('buildOrderedCategories', () => {
  const raw = [
    { category: 'Fixed', entries: [{ type: 'fixed' as const, description: 'Fix bug' }] },
    { category: 'New', entries: [{ type: 'added' as const, description: 'Add feature' }] },
    { category: 'Unknown', entries: [{ type: 'changed' as const, description: 'Some change' }] },
  ];

  it('should map raw categories to EnhancedCategory shape', () => {
    const result = buildOrderedCategories(raw);
    expect(result[0]).toMatchObject({ name: 'Fixed', entries: [{ description: 'Fix bug' }] });
    expect(result[1]).toMatchObject({ name: 'New', entries: [{ description: 'Add feature' }] });
  });

  it('should preserve original order when no config categories provided', () => {
    const result = buildOrderedCategories(raw);
    expect(result.map((c) => c.name)).toEqual(['Fixed', 'New', 'Unknown']);
  });

  it('should sort by config category order', () => {
    const config = [
      { name: 'New', description: 'New features' },
      { name: 'Fixed', description: 'Bug fixes' },
    ];
    const result = buildOrderedCategories(raw, config);
    expect(result.map((c) => c.name)).toEqual(['New', 'Fixed', 'Unknown']);
  });

  it('should append categories not in config order at the end', () => {
    const config = [{ name: 'New', description: 'New features' }];
    const result = buildOrderedCategories(raw, config);
    expect(result[0]?.name).toBe('New');
    expect(result.slice(1).map((c) => c.name)).toContain('Fixed');
    expect(result.slice(1).map((c) => c.name)).toContain('Unknown');
  });

  it('should return empty array for empty input', () => {
    expect(buildOrderedCategories([])).toEqual([]);
    expect(buildOrderedCategories([], [{ name: 'New', description: 'x' }])).toEqual([]);
  });
});
