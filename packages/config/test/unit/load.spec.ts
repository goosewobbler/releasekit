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

  it('should reject packageSpecificTags with a tagTemplate that has no ${packageName}', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({ version: { packageSpecificTags: true, tagTemplate: '${' + 'prefix}${' + 'version}' } }),
    );

    expect(() => loadConfig()).toThrow(ConfigError);
    expect(() => loadConfig()).toThrow(/version\.tagTemplate:.*\$\{packageName\}.*packageSpecificTags/);
  });

  it('should reject a tagTemplate with text after ${version}', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({ version: { tagTemplate: 'release-${' + 'version}-stable' } }),
    );

    expect(() => loadConfig()).toThrow(/version\.tagTemplate: tagTemplate must end with \$\{version\}/);
  });

  it('should reject a tagTemplate with a version before ${version}', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({ version: { tagTemplate: 'releases/2026.1.0/${' + 'version}' } }),
    );

    expect(() => loadConfig()).toThrow(/version\.tagTemplate: tagTemplate can't contain a version before/);
  });

  it('should reject an unknown key, naming its full path', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify({ ci: { labels: { bogus: 'release:bogus' } } }));

    expect(() => loadConfig()).toThrow(ConfigError);
    expect(() => loadConfig()).toThrow(/^Config validation errors:\n {2}ci\.labels\.bogus: unknown key$/);
  });

  it('should report every unknown key, including top-level, union-branch and map-value keys', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        typo: true,
        ci: { prPreview: { enabled: true, stale: true } },
        notes: { changelog: { mode: 'root', bogus: 1, other: 2 } },
        version: { sync: false, groups: { core: { packages: ['@scope/*'], sync: 'fixed', extra: 1 } } },
      }),
    );

    expect(() => loadConfig()).toThrow(
      [
        'Config validation errors:',
        '  version.groups.core.extra: unknown key',
        '  notes.changelog.bogus: unknown key',
        '  notes.changelog.other: unknown key',
        '  ci.prPreview.stale: unknown key',
        '  typo: unknown key',
      ].join('\n'),
    );
  });

  it('should accept arbitrary keys in free-form maps', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        version: { sync: false, groups: { 'any-name': { packages: ['@scope/*'], sync: 'linked' } } },
        ci: { scopeLabels: { 'scope:anything': '@scope/*' } },
      }),
    );

    const result = loadConfig();
    expect(result.version?.groups?.['any-name']?.sync).toBe('linked');
    expect(result.ci?.scopeLabels).toEqual({ 'scope:anything': '@scope/*' });
  });

  it.each([
    [
      'ci.prPreview.refreshAfterRelease',
      { ci: { prPreview: { refreshAfterRelease: true } } },
      /renamed to markStaleAfterRelease/,
    ],
    ['ci.labels.stable', { ci: { labels: { stable: 'release:stable' } } }, /renamed to ci\.labels\.graduate/],
    ['ci.skipPatterns', { ci: { skipPatterns: ['chore: release '] } }, /moved to release\.ci\.skipPatterns/],
    ['notes.releaseNotes.mode', { notes: { releaseNotes: { mode: 'versioned' } } }, /notes\.changelog\.mode/],
    [
      'notes.releaseNotes.llm.prompts.templates',
      { notes: { releaseNotes: { llm: { provider: 'ollama', model: 'm', prompts: { templates: {} } } } } },
      /prompts\.instructions/,
    ],
    ['version.versionStrategy', { version: { versionStrategy: 'branchPattern' } }, /Conventional Commits/],
    ['version.baseBranch', { version: { baseBranch: 'main' } }, /moved to git\.branch/],
    ['monorepo.mainPackage', { monorepo: { mainPackage: 'core' } }, /moved to version\.mainPackage/],
    ['monorepo.mode', { monorepo: { mode: 'packages' } }, /notes\.changelog\.mode/],
  ])('should name the replacement for the removed %s', (key, config, guidance) => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(config));

    expect(() => loadConfig()).toThrow(`Config validation errors:\n  ${key}: `);
    expect(() => loadConfig()).toThrow(guidance);
  });

  it('should report a removed key together with the other errors', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify({ monorepo: { mode: 'packages' }, ci: { labls: {} } }));

    expect(() => loadConfig()).toThrow(
      [
        'Config validation errors:',
        '  monorepo.mode: removed - changelog aggregation is set by notes.changelog.mode',
        '  ci.labls: unknown key',
      ].join('\n'),
    );
  });

  it('should throw a migration error when notes.releaseNotes.file is a string', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify({ notes: { releaseNotes: { file: 'RELEASE_NOTES.md' } } }));

    expect(() => loadConfig()).toThrow(/notes\.releaseNotes\.file: the string form was removed/);
  });

  it('should accept the new notes.releaseNotes.file object shape', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({ notes: { releaseNotes: { file: { dir: 'release-notes' } } } }),
    );

    expect(() => loadConfig()).not.toThrow();
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

  describe('validation errors', () => {
    function mockConfig(config: unknown): void {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(config));
    }

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('should report the nested failure inside a false-or-object union', () => {
      mockConfig({ notes: { releaseNotes: { llm: { provider: 'openai-compatible', model: 'local' } } } });

      expect(() => loadConfig()).toThrow(
        'Config validation errors:\n  notes.releaseNotes.llm.baseURL: baseURL is required when provider is "openai-compatible".',
      );
    });

    it('should keep the union-level error when no branch matches the value type', () => {
      mockConfig({ notes: { releaseNotes: true } });

      expect(() => loadConfig()).toThrow('Config validation errors:\n  notes.releaseNotes: Invalid input');
    });

    it('should name the unset {env:} variable a required field came from', () => {
      vi.stubEnv('LLM_PROVIDER', undefined);
      mockConfig({ notes: { releaseNotes: { llm: { provider: '{env:LLM_PROVIDER}', model: 'm' } } } });

      expect(() => loadConfig()).toThrow(
        'Config validation errors:\n  notes.releaseNotes.llm.provider: {env:LLM_PROVIDER} is not set',
      );
    });

    it('should report a misspelled key as unknown even when its value is an unset {env:} variable', () => {
      vi.stubEnv('OPENAI_KEY', undefined);
      mockConfig({ notes: { releaseNotes: { llm: { provider: 'openai', model: 'm', apiKye: '{env:OPENAI_KEY}' } } } });

      expect(() => loadConfig()).toThrow('Config validation errors:\n  notes.releaseNotes.llm.apiKye: unknown key');
    });

    it('should load with llm.model from an unset {env:} variable', () => {
      vi.stubEnv('OLLAMA_MODEL', undefined);
      mockConfig({ notes: { releaseNotes: { llm: { provider: 'ollama', model: '{env:OLLAMA_MODEL}' } } } });

      expect(loadConfig().notes?.releaseNotes).toMatchObject({ llm: { provider: 'ollama', model: undefined } });
    });
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

  it('should allow publish git to override top-level formatCommand', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        git: { formatCommand: 'biome format --write' },
        publish: { git: { formatCommand: 'prettier --write' } },
      }),
    );

    expect(loadPublishConfig().git?.formatCommand).toBe('prettier --write');
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
    expect(result?.prPreview).toEqual({ enabled: false, markStaleAfterRelease: false });
  });

  it('should return undefined when no CI config', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue('{}');

    const result = loadCIConfig();
    expect(result).toBeUndefined();
  });
});
