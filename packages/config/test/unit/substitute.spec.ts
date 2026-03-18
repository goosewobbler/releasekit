import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAuth, saveAuth, substituteInObject, substituteVariables } from '../../src/substitute.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

const mockedFs = vi.mocked(fs);

describe('substituteVariables', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv, TEST_VAR: 'test-value', API_KEY: 'secret-123' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('substitutes {env:VAR} with environment variable', () => {
    const result = substituteVariables('Value: {env:TEST_VAR}');
    expect(result).toBe('Value: test-value');
  });

  it('substitutes multiple environment variables', () => {
    const result = substituteVariables('{env:TEST_VAR} and {env:API_KEY}');
    expect(result).toBe('test-value and secret-123');
  });

  it('returns empty string for missing environment variable', () => {
    const result = substituteVariables('Value: {env:MISSING_VAR}');
    expect(result).toBe('Value: ');
  });

  it('returns original string when no variables', () => {
    const result = substituteVariables('No variables here');
    expect(result).toBe('No variables here');
  });

  it('substitutes {file:PATH} with file contents', () => {
    mockedFs.readFileSync.mockReturnValue('  file contents  \n');
    const result = substituteVariables('File: {file:/path/to/file.txt}');
    expect(result).toBe('File: file contents');
    expect(mockedFs.readFileSync).toHaveBeenCalledWith('/path/to/file.txt', 'utf-8');
  });

  it('expands ~ to home directory in file path', () => {
    mockedFs.readFileSync.mockReturnValue('contents');
    substituteVariables('{file:~/secrets/api-key}');
    expect(mockedFs.readFileSync).toHaveBeenCalledWith(path.join(os.homedir(), 'secrets/api-key'), 'utf-8');
  });

  it('returns empty string for unreadable file', () => {
    mockedFs.readFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const result = substituteVariables('{file:/nonexistent}');
    expect(result).toBe('');
  });

  it('substitutes mixed env and file variables', () => {
    mockedFs.readFileSync.mockReturnValue('file-content');
    const result = substituteVariables('{env:TEST_VAR} and {file:/path/to/file}');
    expect(result).toBe('test-value and file-content');
  });
});

describe('substituteInObject', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, API_KEY: 'secret-123' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('substitutes variables in string values', () => {
    const obj = { apiKey: '{env:API_KEY}' };
    const result = substituteInObject(obj);
    expect(result).toEqual({ apiKey: 'secret-123' });
  });

  it('substitutes variables in nested objects', () => {
    const obj = {
      config: {
        apiKey: '{env:API_KEY}',
        other: 'value',
      },
    };
    const result = substituteInObject(obj);
    expect(result).toEqual({
      config: {
        apiKey: 'secret-123',
        other: 'value',
      },
    });
  });

  it('substitutes variables in arrays', () => {
    const obj = {
      keys: ['{env:API_KEY}', 'static-value'],
    };
    const result = substituteInObject(obj);
    expect(result).toEqual({
      keys: ['secret-123', 'static-value'],
    });
  });

  it('preserves non-string values', () => {
    const obj = {
      num: 42,
      bool: true,
      nil: null,
    };
    const result = substituteInObject(obj);
    expect(result).toEqual(obj);
  });

  it('handles null input', () => {
    const result = substituteInObject(null);
    expect(result).toBeNull();
  });

  it('handles undefined input', () => {
    const result = substituteInObject(undefined);
    expect(result).toBeUndefined();
  });

  it('handles primitive input', () => {
    expect(substituteInObject(42)).toBe(42);
    expect(substituteInObject(true)).toBe(true);
  });

  it('handles empty object', () => {
    const result = substituteInObject({});
    expect(result).toEqual({});
  });

  it('handles empty array', () => {
    const result = substituteInObject([]);
    expect(result).toEqual([]);
  });

  it('returns undefined for sole {env:MISSING} reference that resolves to empty', () => {
    const obj = { apiKey: '{env:DOES_NOT_EXIST_XYZ}' };
    const result = substituteInObject(obj);
    expect(result.apiKey).toBeUndefined();
  });

  it('returns empty string for partial {env:MISSING} within a larger string', () => {
    const obj = { url: 'https://{env:DOES_NOT_EXIST_XYZ}:8080' };
    const result = substituteInObject(obj);
    expect(result.url).toBe('https://:8080');
  });

  it('returns undefined for sole {file:MISSING} reference that resolves to empty', () => {
    mockedFs.readFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const obj = { secret: '{file:/nonexistent/path}' };
    const result = substituteInObject(obj);
    expect(result.secret).toBeUndefined();
  });

  it('substitutes in deeply nested structures', () => {
    const obj = {
      level1: {
        level2: {
          level3: {
            value: '{env:API_KEY}',
          },
        },
      },
    };
    const result = substituteInObject(obj);
    expect(result.level1.level2.level3.value).toBe('secret-123');
  });
});

describe('loadAuth', () => {
  it('returns empty object when auth file does not exist', () => {
    mockedFs.existsSync.mockReturnValue(false);
    const result = loadAuth();
    expect(result).toEqual({});
  });

  it('returns parsed auth file contents', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue('{"openai": "sk-test", "anthropic": "key-123"}');
    const result = loadAuth();
    expect(result).toEqual({ openai: 'sk-test', anthropic: 'key-123' });
  });

  it('returns empty object on parse error', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue('invalid json');
    const result = loadAuth();
    expect(result).toEqual({});
  });
});

describe('saveAuth', () => {
  it('creates auth directory if it does not exist', () => {
    mockedFs.existsSync.mockReturnValue(false);
    mockedFs.readFileSync.mockReturnValue('{}');
    saveAuth('openai', 'sk-test');
    expect(mockedFs.mkdirSync).toHaveBeenCalled();
  });

  it('writes auth data with provider key', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue('{}');
    saveAuth('openai', 'sk-test');
    const writeCall = mockedFs.writeFileSync.mock.calls[0];
    const written = JSON.parse(writeCall[1] as string);
    expect(written).toEqual({ openai: 'sk-test' });
  });

  it('writes to correct file path', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue('{}');
    saveAuth('openai', 'sk-test');
    const writeCall = mockedFs.writeFileSync.mock.calls[0];
    expect(writeCall[0]).toContain('releasekit');
    expect(writeCall[0]).toContain('auth.json');
  });

  it('writes with proper formatting', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue('{}');
    saveAuth('openai', 'sk-test');
    const writeCall = mockedFs.writeFileSync.mock.calls[0];
    expect(writeCall[1]).toContain('\n  ');
  });
});
