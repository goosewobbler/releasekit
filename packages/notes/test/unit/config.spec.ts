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

  it('should return default config when no config file exists', () => {
    withTempDir((dir) => {
      const config = loadConfig(dir);
      expect(config.output[0]?.format).toBe('markdown');
      expect(config.output[0]?.file).toBe('CHANGELOG.md');
      expect(config.updateStrategy).toBe('prepend');
    });
  });

  it('should load releasekit.config.json with notes section', () => {
    withTempDir((dir) => {
      fs.writeFileSync(
        path.join(dir, 'releasekit.config.json'),
        JSON.stringify({
          notes: {
            output: [{ format: 'json', file: 'out.json' }],
            updateStrategy: 'regenerate',
          },
        }),
        'utf-8',
      );

      const config = loadConfig(dir);
      expect(config.output[0]?.format).toBe('json');
      expect(config.updateStrategy).toBe('regenerate');
    });
  });

  it('substitutes {env:VAR} with environment variable value', () => {
    process.env.TEST_API_KEY = 'sk-test-123';

    withTempDir((dir) => {
      fs.writeFileSync(
        path.join(dir, 'releasekit.config.json'),
        JSON.stringify({
          notes: {
            output: [],
            llm: { provider: 'openai', model: 'gpt-4o-mini', apiKey: '{env:TEST_API_KEY}' },
          },
        }),
        'utf-8',
      );

      const config = loadConfig(dir);
      expect(config.llm?.apiKey).toBe('sk-test-123');
    });
  });

  it('treats unresolved {env:MISSING_VAR} as undefined (absent)', () => {
    withTempDir((dir) => {
      fs.writeFileSync(
        path.join(dir, 'releasekit.config.json'),
        JSON.stringify({
          notes: {
            output: [],
            llm: { provider: 'openai', model: 'gpt-4o-mini', apiKey: '{env:DEFINITELY_NOT_SET_XYZ}' },
          },
        }),
        'utf-8',
      );

      const config = loadConfig(dir);
      expect(config.llm?.apiKey).toBeUndefined();
    });
  });

  it('should parse JSONC (strips comments)', () => {
    withTempDir((dir) => {
      fs.writeFileSync(
        path.join(dir, 'releasekit.config.json'),
        `{
  // This is a comment
  "notes": {
    "output": [{ "format": "markdown" }],
    /* block comment */
    "updateStrategy": "regenerate"
  }
}`,
        'utf-8',
      );

      const config = loadConfig(dir);
      expect(config.updateStrategy).toBe('regenerate');
    });
  });

  it('explicit --config path takes precedence', () => {
    withTempDir((dir) => {
      fs.writeFileSync(
        path.join(dir, 'releasekit.config.json'),
        JSON.stringify({ notes: { output: [{ format: 'markdown' }] } }),
        'utf-8',
      );

      const customPath = path.join(dir, 'custom.json');
      fs.writeFileSync(customPath, JSON.stringify({ notes: { output: [{ format: 'json' }] } }), 'utf-8');

      const config = loadConfig(dir, customPath);
      expect(config.output[0]?.format).toBe('json');
    });
  });

  it('should throw on invalid JSON', () => {
    withTempDir((dir) => {
      fs.writeFileSync(path.join(dir, 'releasekit.config.json'), '{ not valid json }', 'utf-8');

      expect(() => loadConfig(dir)).toThrow();
    });
  });
});
