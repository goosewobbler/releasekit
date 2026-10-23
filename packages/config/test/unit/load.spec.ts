import * as fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigError } from '../../src/errors.js';
import {
  loadCIConfig,
  loadConfig,
  loadGitConfig,
  loadNotesConfig,
  loadPublishConfig,
  loadVersionConfig,
} from '../../src/load.js';
import { PublishConfigSchema } from '../../src/schema.js';

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

  it('should return an empty object when the config file does not exist', () => {
    mockedFs.existsSync.mockReturnValue(false);
    const result = loadConfig();
    expect(result).toEqual({});
  });

  it('should load and parse a valid config file', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        git: { remote: 'origin', branch: 'main' },
        version: { preset: 'angular' },
      }),
    );

    const result = loadConfig();
    expect(result.git?.remote).toBe('origin');
    expect(result.version?.preset).toBe('angular');
  });

  it('should accept a custom cwd', () => {
    mockedFs.existsSync.mockReturnValue(false);
    loadConfig({ cwd: '/custom/path' });
    expect(mockedFs.existsSync).toHaveBeenCalledWith('/custom/path/releasekit.config.json');
  });

  it('should accept a custom configPath', () => {
    mockedFs.existsSync.mockReturnValue(false);
    loadConfig({ configPath: '/custom/path/my-config.json' });
    expect(mockedFs.existsSync).toHaveBeenCalledWith('/custom/path/my-config.json');
  });

  it('should throw ConfigError on invalid JSON', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue('{ invalid json }');

    expect(() => loadConfig()).toThrow(ConfigError);
  });

  it('should throw ConfigError on schema validation failure', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        version: { zeroMajor: 'invalid-strategy' },
      }),
    );

    expect(() => loadConfig()).toThrow(ConfigError);
  });

  it.each(['nonsense', 'conventional', 'conventional-commits'])(
    'should throw a ConfigError listing the supported presets for preset "%s"',
    (preset) => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify({ version: { preset } }));

      expect(() => loadConfig()).toThrow(ConfigError);
      expect(() => loadConfig()).toThrow(/version\.preset:.*"angular".*"conventionalcommits"/);
    },
  );

  it('should throw a migration error for the removed notes.releaseNotes.mode', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify({ notes: { releaseNotes: { mode: 'versioned' } } }));

    expect(() => loadConfig()).toThrow(/notes\.releaseNotes no longer supports mode/);
  });

  it('should throw a migration error when notes.releaseNotes.file is a string', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify({ notes: { releaseNotes: { file: 'RELEASE_NOTES.md' } } }));

    expect(() => loadConfig()).toThrow(/file \(string\)/);
  });

  it('should accept the new notes.releaseNotes.file object shape', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({ notes: { releaseNotes: { file: { dir: 'release-notes' } } } }),
    );

    expect(() => loadConfig()).not.toThrow();
  });

  it('should throw a migration error for removed version fields', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify({ version: { versionStrategy: 'branchPattern' } }));

    expect(() => loadConfig()).toThrow(/version no longer supports/);
  });

  it('should throw a migration error for removed ci fields', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify({ ci: { skipPatterns: ['chore: release '] } }));

    expect(() => loadConfig()).toThrow(/ci no longer supports/);
  });

  it('should throw a migration error for the removed monorepo.mainPackage', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify({ monorepo: { mainPackage: 'core' } }));

    expect(() => loadConfig()).toThrow(/monorepo\.mainPackage was removed/);
  });

  it('should throw a migration error for the removed monorepo.mode', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify({ monorepo: { mode: 'packages' } }));

    expect(() => loadConfig()).toThrow(/monorepo\.mode was removed/);
  });

  it('should parse JSONC with comments', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(`{
      // This is a comment
      "git": { "remote": "origin" }
    }`);

    const result = loadConfig();
    expect(result.git?.remote).toBe('origin');
  });

  it('should discover releasekit.config.jsonc when no .json file exists', () => {
    mockedFs.existsSync.mockImplementation((p) => String(p).endsWith('releasekit.config.jsonc'));
    mockedFs.readFileSync.mockReturnValue(`{
      // standing-pr config
      "$schema": "https://goosewobbler.github.io/releasekit/schema.json",
      "git": { "pushMethod": "ssh" }
    }`);

    const result = loadConfig();
    expect(result.git?.pushMethod).toBe('ssh');
    expect(mockedFs.existsSync).toHaveBeenCalledWith(expect.stringContaining('releasekit.config.jsonc'));
  });

  it('should prefer releasekit.config.json over .jsonc when both exist', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockImplementation((p) =>
      String(p).endsWith('releasekit.config.json')
        ? JSON.stringify({ git: { remote: 'from-json' } })
        : JSON.stringify({ git: { remote: 'from-jsonc' } }),
    );

    const result = loadConfig();
    expect(result.git?.remote).toBe('from-json');
  });

  it('should substitute environment variables', () => {
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

  it('should return version config from loaded config', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        version: { preset: 'angular', sync: false },
      }),
    );

    const result = loadVersionConfig();
    expect(result?.preset).toBe('angular');
    expect(result?.sync).toBe(false);
  });

  it('should return undefined when no version config', () => {
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

  it('should return publish config from loaded config', () => {
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

  it.each([
    ['no publish block', {}],
    ['an empty publish block', { publish: {} }],
  ])('should apply the schema defaults with %s', (_label, config) => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(config));

    expect(loadPublishConfig()).toEqual({ ...PublishConfigSchema.parse({}), git: undefined });
  });

  it('should inherit the top-level git config without a publish block', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify({ git: { push: false, remote: 'upstream' } }));

    const result = loadPublishConfig();
    expect(result.git?.push).toBe(false);
    expect(result.git?.remote).toBe('upstream');
  });

  it('should merge top-level git config with publish git config', () => {
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

  it('should use publish git config when no top-level git config', () => {
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

  it('should not let a publish.git block override an explicit top-level git.push: false', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        git: { push: false },
        publish: { git: { remote: 'upstream' } },
      }),
    );

    const result = loadPublishConfig();
    expect(result?.git?.push).toBe(false);
  });

  it('should let publish.git.push explicitly override top-level git.push', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        git: { push: false },
        publish: { git: { push: true } },
      }),
    );

    const result = loadPublishConfig();
    expect(result?.git?.push).toBe(true);
  });

  it('should inherit skipHooks from top-level git config', () => {
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

  it('should allow publish git to override top-level skipHooks', () => {
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

  it('should return notes config from loaded config', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        notes: { changelog: { mode: 'packages' } },
      }),
    );

    const result = loadNotesConfig();
    expect(result?.changelog).toMatchObject({ mode: 'packages' });
  });

  it('should return undefined when no notes config exists', () => {
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

  it('should return git config from loaded config', () => {
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

  it('should return undefined when no git config exists', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue('{}');

    const result = loadGitConfig();
    expect(result).toBeUndefined();
  });
});

describe('loadCIConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return CI config from loaded config', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        ci: { prPreview: false },
      }),
    );

    const result = loadCIConfig();
    expect(result?.prPreview).toEqual({ enabled: false, refreshAfterRelease: false });
  });

  it('should return undefined when no CI config', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue('{}');

    const result = loadCIConfig();
    expect(result).toBeUndefined();
  });
});
