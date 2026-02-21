import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/core/config.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withTempDir(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'changelog-creator-test-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeConfig(dir: string, obj: unknown, name = 'changelog.config.json'): string {
  const configPath = path.join(dir, name);
  fs.writeFileSync(configPath, JSON.stringify(obj), 'utf-8');
  return configPath;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('loadConfig()', () => {
  afterEach(() => {
    delete process.env.CHANGELOG_CONFIG_CONTENT;
    delete process.env.CHANGELOG_CONFIG;
    delete process.env.TEST_API_KEY;
  });

  it('returns default config when no config file exists', () => {
    withTempDir((dir) => {
      const config = loadConfig(dir);
      expect(config.output).toEqual([]);
      expect(config.llm).toBeUndefined();
    });
  });

  it('loads changelog.config.json from project dir', () => {
    withTempDir((dir) => {
      writeConfig(dir, {
        output: [{ format: 'markdown', file: 'CHANGELOG.md' }],
        updateStrategy: 'prepend',
      });

      const config = loadConfig(dir);
      expect(config.output[0]?.format).toBe('markdown');
      expect(config.updateStrategy).toBe('prepend');
    });
  });

  it('loads from CHANGELOG_CONFIG_CONTENT env var', () => {
    process.env.CHANGELOG_CONFIG_CONTENT = JSON.stringify({
      output: [{ format: 'json', file: 'out.json' }],
    });

    const config = loadConfig(process.cwd());
    expect(config.output[0]?.format).toBe('json');
  });

  it('CHANGELOG_CONFIG_CONTENT takes precedence over config file', () => {
    withTempDir((dir) => {
      writeConfig(dir, { output: [{ format: 'markdown' }] });

      process.env.CHANGELOG_CONFIG_CONTENT = JSON.stringify({
        output: [{ format: 'json' }],
      });

      const config = loadConfig(dir);
      expect(config.output[0]?.format).toBe('json');
    });
  });

  it('substitutes {env:VAR} with environment variable value', () => {
    process.env.TEST_API_KEY = 'sk-test-123';

    withTempDir((dir) => {
      writeConfig(dir, {
        output: [],
        llm: { provider: 'openai', model: 'gpt-4o-mini', apiKey: '{env:TEST_API_KEY}' },
      });

      const config = loadConfig(dir);
      expect(config.llm?.apiKey).toBe('sk-test-123');
    });
  });

  it('substitutes {env:MISSING_VAR} with empty string', () => {
    withTempDir((dir) => {
      writeConfig(dir, {
        output: [],
        llm: { provider: 'openai', model: 'gpt-4o-mini', apiKey: '{env:DEFINITELY_NOT_SET_XYZ}' },
      });

      const config = loadConfig(dir);
      expect(config.llm?.apiKey).toBe('');
    });
  });

  it('parses JSONC (strips comments)', () => {
    withTempDir((dir) => {
      const configPath = path.join(dir, 'changelog.config.jsonc');
      fs.writeFileSync(
        configPath,
        `{
  // This is a comment
  "output": [{ "format": "markdown" }],
  /* block comment */
  "updateStrategy": "regenerate"
}`,
        'utf-8',
      );

      const config = loadConfig(dir);
      expect(config.updateStrategy).toBe('regenerate');
    });
  });

  it('explicit --config path takes precedence over project file', () => {
    withTempDir((dir) => {
      writeConfig(dir, { output: [{ format: 'markdown' }] });
      const explicitPath = writeConfig(dir, { output: [{ format: 'json' }] }, 'explicit.json');

      const config = loadConfig(dir, explicitPath);
      expect(config.output[0]?.format).toBe('json');
    });
  });

  it('throws ConfigError on invalid JSON', () => {
    withTempDir((dir) => {
      const configPath = path.join(dir, 'changelog.config.json');
      fs.writeFileSync(configPath, '{ not valid json }', 'utf-8');

      expect(() => loadConfig(dir)).toThrow();
    });
  });
});
