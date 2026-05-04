import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/core/config.js';

function withTempDir(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'releasekit-notes-test-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('loadConfig()', () => {
  afterEach(() => {
    delete process.env.TEST_API_KEY;
  });

  it('should return empty config when no config file exists', () => {
    withTempDir((dir) => {
      const config = loadConfig(dir);
      expect(config).toEqual({});
    });
  });

  it('should load releasekit.config.json with notes section', () => {
    withTempDir((dir) => {
      fs.writeFileSync(
        path.join(dir, 'releasekit.config.json'),
        JSON.stringify({
          notes: {
            changelog: { mode: 'packages', file: 'CHANGELOG.md' },
          },
        }),
        'utf-8',
      );

      const config = loadConfig(dir);
      expect(config.changelog).toMatchObject({ mode: 'packages', file: 'CHANGELOG.md' });
    });
  });

  it('should substitute {env:VAR} with environment variable value', () => {
    process.env.TEST_API_KEY = 'sk-test-123';

    withTempDir((dir) => {
      fs.writeFileSync(
        path.join(dir, 'releasekit.config.json'),
        JSON.stringify({
          notes: {
            releaseNotes: {
              llm: { provider: 'openai', model: 'gpt-4o-mini', apiKey: '{env:TEST_API_KEY}' },
            },
          },
        }),
        'utf-8',
      );

      const config = loadConfig(dir);
      expect(config.releaseNotes).not.toBe(false);
      expect((config.releaseNotes as { llm?: { apiKey?: string } })?.llm?.apiKey).toBe('sk-test-123');
    });
  });

  it('should treat unresolved {env:MISSING_VAR} as undefined (absent)', () => {
    withTempDir((dir) => {
      fs.writeFileSync(
        path.join(dir, 'releasekit.config.json'),
        JSON.stringify({
          notes: {
            releaseNotes: {
              llm: { provider: 'openai', model: 'gpt-4o-mini', apiKey: '{env:DEFINITELY_NOT_SET_XYZ}' },
            },
          },
        }),
        'utf-8',
      );

      const config = loadConfig(dir);
      expect(config.releaseNotes).not.toBe(false);
      expect((config.releaseNotes as { llm?: { apiKey?: string } })?.llm?.apiKey).toBeUndefined();
    });
  });

  it('should parse JSONC (strips comments)', () => {
    withTempDir((dir) => {
      fs.writeFileSync(
        path.join(dir, 'releasekit.config.json'),
        `{
  // comment
  "notes": { "changelog": { "mode": "packages" } }
}`,
        'utf-8',
      );

      const config = loadConfig(dir);
      expect(config.changelog).toMatchObject({ mode: 'packages' });
    });
  });

  it('should use config from explicit --config path over default config file', () => {
    withTempDir((dir) => {
      fs.writeFileSync(
        path.join(dir, 'releasekit.config.json'),
        JSON.stringify({ notes: { changelog: false } }),
        'utf-8',
      );

      const customPath = path.join(dir, 'custom.json');
      fs.writeFileSync(customPath, JSON.stringify({ notes: { changelog: { mode: 'packages' } } }), 'utf-8');

      const config = loadConfig(dir, customPath);
      expect(config.changelog).toMatchObject({ mode: 'packages' });
    });
  });

  it('should throw on invalid JSON', () => {
    withTempDir((dir) => {
      fs.writeFileSync(path.join(dir, 'releasekit.config.json'), '{ not valid json }', 'utf-8');

      expect(() => loadConfig(dir)).toThrow();
    });
  });
});
