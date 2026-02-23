import { describe, expect, it } from 'vitest';
import { parseManualInput } from '../../../src/input/manual.js';

describe('parseManualInput', () => {
  it('parses valid JSON with packages array', () => {
    const json = JSON.stringify({
      packages: [
        {
          packageName: '@scope/my-package',
          version: '2.0.0',
          previousVersion: '1.0.0',
          entries: [
            { type: 'added', description: 'New feature' },
            { type: 'fixed', description: 'Bug fix' },
          ],
        },
      ],
    });

    const result = parseManualInput(json);

    expect(result.source).toBe('manual');
    expect(result.packages).toHaveLength(1);
    expect(result.packages[0]?.packageName).toBe('@scope/my-package');
    expect(result.packages[0]?.version).toBe('2.0.0');
    expect(result.packages[0]?.entries).toHaveLength(2);
  });

  it('applies defaults for missing fields', () => {
    const json = JSON.stringify({
      packages: [{}],
    });

    const result = parseManualInput(json);

    expect(result.packages[0]?.packageName).toBe('package');
    expect(result.packages[0]?.version).toBe('0.0.0');
    expect(result.packages[0]?.previousVersion).toBeNull();
    expect(result.packages[0]?.revisionRange).toBe('HEAD');
    expect(result.packages[0]?.entries).toEqual([]);
  });

  it('creates default package when packages array is empty', () => {
    const json = JSON.stringify({ packages: [] });

    const result = parseManualInput(json);

    expect(result.packages).toHaveLength(1);
    expect(result.packages[0]?.packageName).toBe('package');
  });

  it('creates default package when no packages key', () => {
    const json = JSON.stringify({});

    const result = parseManualInput(json);

    expect(result.packages).toHaveLength(1);
    expect(result.packages[0]?.packageName).toBe('package');
  });

  it('extracts repoUrl from metadata', () => {
    const json = JSON.stringify({
      repoUrl: 'https://github.com/owner/repo',
      packages: [],
    });

    const result = parseManualInput(json);

    expect(result.metadata?.repoUrl).toBe('https://github.com/owner/repo');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseManualInput('not valid json')).toThrow('Invalid JSON input');
  });

  it('throws on non-object input', () => {
    expect(() => parseManualInput('"string"')).toThrow('Input must be a JSON object');
    expect(() => parseManualInput('null')).toThrow('Input must be a JSON object');
  });

  it('normalizes entry types', () => {
    const json = JSON.stringify({
      packages: [
        {
          entries: [
            { type: 'feat', description: 'Feature' },
            { type: 'fix', description: 'Fix' },
            { type: 'feature', description: 'Another feature' },
            { type: 'bugfix', description: 'Bug fix' },
            { type: 'invalid', description: 'Unknown type' },
          ],
        },
      ],
    });

    const result = parseManualInput(json);

    const types = result.packages[0]?.entries.map((e) => e.type);
    expect(types).toEqual(['added', 'fixed', 'added', 'fixed', 'changed']);
  });

  it('normalizes entry fields', () => {
    const json = JSON.stringify({
      packages: [
        {
          entries: [
            {
              type: 'added',
              description: 'Feature',
              scope: 'api',
              issueIds: ['#123', '#456'],
              breaking: true,
              originalType: 'feat',
            },
          ],
        },
      ],
    });

    const result = parseManualInput(json);

    const entry = result.packages[0]?.entries[0];
    expect(entry?.scope).toBe('api');
    expect(entry?.issueIds).toEqual(['#123', '#456']);
    expect(entry?.breaking).toBe(true);
    expect(entry?.originalType).toBe('feat');
  });

  it('handles invalid entries gracefully', () => {
    const json = JSON.stringify({
      packages: [
        {
          entries: [null, 'string', { description: 'Valid entry' }],
        },
      ],
    });

    const result = parseManualInput(json);

    expect(result.packages[0]?.entries).toHaveLength(3);
    expect(result.packages[0]?.entries[0]?.description).toBe('Unknown change');
    expect(result.packages[0]?.entries[1]?.description).toBe('Unknown change');
    expect(result.packages[0]?.entries[2]?.description).toBe('Valid entry');
  });

  it('handles invalid package entries in array', () => {
    const json = JSON.stringify({
      packages: [null, 'string', { packageName: 'valid-package' }],
    });

    const result = parseManualInput(json);

    expect(result.packages).toHaveLength(1);
    expect(result.packages[0]?.packageName).toBe('valid-package');
  });

  it('preserves revision range', () => {
    const json = JSON.stringify({
      packages: [
        {
          revisionRange: 'v1.0.0..v2.0.0',
        },
      ],
    });

    const result = parseManualInput(json);

    expect(result.packages[0]?.revisionRange).toBe('v1.0.0..v2.0.0');
  });

  it('handles date field', () => {
    const json = JSON.stringify({
      packages: [
        {
          date: '2024-01-15',
        },
      ],
    });

    const result = parseManualInput(json);

    expect(result.packages[0]?.date).toBe('2024-01-15');
  });

  it('generates current date when not provided', () => {
    const json = JSON.stringify({ packages: [{}] });
    const today = new Date().toISOString().split('T')[0];

    const result = parseManualInput(json);

    expect(result.packages[0]?.date).toBe(today);
  });

  it('maps type aliases correctly', () => {
    const typeAliases = {
      update: 'changed',
      refactor: 'changed',
      remove: 'removed',
      delete: 'removed',
      deprecate: 'deprecated',
      sec: 'security',
    };

    for (const [alias, expected] of Object.entries(typeAliases)) {
      const json = JSON.stringify({
        packages: [{ entries: [{ type: alias, description: 'Test' }] }],
      });

      const result = parseManualInput(json);
      expect(result.packages[0]?.entries[0]?.type).toBe(expected);
    }
  });

  it('accepts valid changelog types directly', () => {
    const validTypes = ['added', 'changed', 'deprecated', 'removed', 'fixed', 'security'];

    for (const type of validTypes) {
      const json = JSON.stringify({
        packages: [{ entries: [{ type, description: 'Test' }] }],
      });

      const result = parseManualInput(json);
      expect(result.packages[0]?.entries[0]?.type).toBe(type);
    }
  });
});
