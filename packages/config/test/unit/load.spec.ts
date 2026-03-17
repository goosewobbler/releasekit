import * as fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigError } from '../../src/errors.js';
import { loadConfig, loadGitConfig, loadNotesConfig, loadPublishConfig, loadVersionConfig } from '../../src/load.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const mockedFs = vi.mocked(fs);

describe('loadConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('returns empty object when config file does not exist', () => {
    mockedFs.existsSync.mockReturnValue(false);
    const result = loadConfig();
    expect(result).toEqual({});
  });

  it('loads and parses valid config file', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        git: { remote: 'origin', branch: 'main' },
        version: { preset: 'conventional' },
      }),
    );

    const result = loadConfig();
    expect(result.git?.remote).toBe('origin');
    expect(result.version?.preset).toBe('conventional');
  });

  it('accepts custom cwd', () => {
    mockedFs.existsSync.mockReturnValue(false);
    loadConfig({ cwd: '/custom/path' });
    expect(mockedFs.existsSync).toHaveBeenCalledWith('/custom/path/releasekit.config.json');
  });

  it('accepts custom configPath', () => {
    mockedFs.existsSync.mockReturnValue(false);
    loadConfig({ configPath: '/custom/path/my-config.json' });
    expect(mockedFs.existsSync).toHaveBeenCalledWith('/custom/path/my-config.json');
  });

  it('throws ConfigError on invalid JSON', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue('{ invalid json }');

    expect(() => loadConfig()).toThrow(ConfigError);
  });

  it('throws ConfigError on schema validation failure', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        version: { versionStrategy: 'invalid-strategy' },
      }),
    );

    expect(() => loadConfig()).toThrow(ConfigError);
  });

  it('parses JSONC with comments', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(`{
      // This is a comment
      "git": { "remote": "origin" }
    }`);

    const result = loadConfig();
    expect(result.git?.remote).toBe('origin');
  });

  it('substitutes environment variables', () => {
    vi.stubEnv('TEST_REMOTE', 'test-origin');
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        git: { remote: '{env:TEST_REMOTE}' },
      }),
    );

    const result = loadConfig();
    expect(result.git?.remote).toBe('test-origin');
  });
});

describe('loadVersionConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns version config from loaded config', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        version: { preset: 'conventional', sync: false },
      }),
    );

    const result = loadVersionConfig();
    expect(result?.preset).toBe('conventional');
    expect(result?.sync).toBe(false);
  });

  it('returns undefined when no version config', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue('{}');

    const result = loadVersionConfig();
    expect(result).toBeUndefined();
  });
});

describe('loadPublishConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns publish config from loaded config', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        publish: {
          npm: { enabled: true, access: 'public' },
          cargo: { enabled: false },
        },
      }),
    );

    const result = loadPublishConfig();
    expect(result?.npm.enabled).toBe(true);
    expect(result?.npm.access).toBe('public');
  });

  it('returns undefined when no publish config', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue('{}');

    const result = loadPublishConfig();
    expect(result).toBeUndefined();
  });

  it('merges top-level git config with publish git config', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        git: { remote: 'upstream', branch: 'develop' },
        publish: {
          git: { branch: 'release' },
        },
      }),
    );

    const result = loadPublishConfig();
    expect(result?.git?.remote).toBe('upstream');
    expect(result?.git?.branch).toBe('release');
  });

  it('uses publish git config when no top-level git config', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        publish: {
          git: { remote: 'origin' },
        },
      }),
    );

    const result = loadPublishConfig();
    expect(result?.git?.remote).toBe('origin');
  });

  it('inherits skipHooks from top-level git config', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        git: { skipHooks: true },
        publish: {},
      }),
    );

    const result = loadPublishConfig();
    expect(result?.git?.skipHooks).toBe(true);
  });

  it('allows publish git to override top-level skipHooks', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        git: { skipHooks: true },
        publish: {
          git: { skipHooks: false },
        },
      }),
    );

    const result = loadPublishConfig();
    expect(result?.git?.skipHooks).toBe(false);
  });
});

describe('loadNotesConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns notes config from loaded config', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        notes: { updateStrategy: 'regenerate' },
      }),
    );

    const result = loadNotesConfig();
    expect(result?.updateStrategy).toBe('regenerate');
  });

  it('returns undefined when no notes config', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue('{}');

    const result = loadNotesConfig();
    expect(result).toBeUndefined();
  });
});

describe('loadGitConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns git config from loaded config', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        git: { remote: 'upstream', branch: 'develop', pushMethod: 'ssh' },
      }),
    );

    const result = loadGitConfig();
    expect(result?.remote).toBe('upstream');
    expect(result?.branch).toBe('develop');
    expect(result?.pushMethod).toBe('ssh');
  });

  it('returns undefined when no git config', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue('{}');

    const result = loadGitConfig();
    expect(result).toBeUndefined();
  });
});
