import { describe, expect, it } from 'vitest';
import {
  BranchPatternSchema,
  CargoPublishConfigSchema,
  GitConfigSchema,
  GitHubReleaseConfigSchema,
  LLMConfigSchema,
  MonorepoConfigSchema,
  NotesConfigSchema,
  NpmConfigSchema,
  OutputConfigSchema,
  PublishConfigSchema,
  ReleaseKitConfigSchema,
  TemplateConfigSchema,
  VerifyConfigSchema,
  VersionConfigSchema,
} from '../../src/schema.js';

describe('GitConfigSchema', () => {
  it('applies defaults for missing fields', () => {
    const result = GitConfigSchema.parse({});
    expect(result).toEqual({
      remote: 'origin',
      branch: 'main',
      pushMethod: 'auto',
    });
  });

  it('accepts valid values', () => {
    const result = GitConfigSchema.parse({
      remote: 'upstream',
      branch: 'develop',
      pushMethod: 'ssh',
      push: false,
    });
    expect(result.remote).toBe('upstream');
    expect(result.branch).toBe('develop');
    expect(result.pushMethod).toBe('ssh');
    expect(result.push).toBe(false);
  });

  it('rejects invalid pushMethod', () => {
    expect(() => GitConfigSchema.parse({ pushMethod: 'invalid' })).toThrow();
  });
});

describe('MonorepoConfigSchema', () => {
  it('accepts empty object', () => {
    const result = MonorepoConfigSchema.parse({});
    expect(result).toEqual({});
  });

  it('accepts valid mode values', () => {
    for (const mode of ['root', 'packages', 'both'] as const) {
      const result = MonorepoConfigSchema.parse({ mode });
      expect(result.mode).toBe(mode);
    }
  });

  it('rejects invalid mode', () => {
    expect(() => MonorepoConfigSchema.parse({ mode: 'invalid' })).toThrow();
  });
});

describe('BranchPatternSchema', () => {
  it('requires pattern and releaseType', () => {
    const result = BranchPatternSchema.parse({
      pattern: 'release/*',
      releaseType: 'minor',
    });
    expect(result.pattern).toBe('release/*');
    expect(result.releaseType).toBe('minor');
  });

  it('rejects invalid releaseType', () => {
    expect(() =>
      BranchPatternSchema.parse({
        pattern: 'release/*',
        releaseType: 'invalid',
      }),
    ).toThrow();
  });
});

describe('VersionConfigSchema', () => {
  it('applies defaults', () => {
    const result = VersionConfigSchema.parse({});
    expect(result.tagTemplate).toBe('v{version}');
    expect(result.packageSpecificTags).toBe(false);
    expect(result.preset).toBe('conventional');
    expect(result.sync).toBe(true);
    expect(result.packages).toEqual([]);
    expect(result.updateInternalDependencies).toBe('minor');
    expect(result.versionStrategy).toBe('commitMessage');
    expect(result.mismatchStrategy).toBe('warn');
    expect(result.versionPrefix).toBe('');
  });

  it('accepts branchPatterns', () => {
    const result = VersionConfigSchema.parse({
      versionStrategy: 'branchPattern',
      branchPatterns: [
        { pattern: 'main', releaseType: 'minor' },
        { pattern: 'feature/*', releaseType: 'patch' },
      ],
    });
    expect(result.versionStrategy).toBe('branchPattern');
    expect(result.branchPatterns).toHaveLength(2);
  });

  it('accepts cargo config', () => {
    const result = VersionConfigSchema.parse({
      cargo: {
        enabled: true,
        paths: ['crates/core', 'crates/cli'],
      },
    });
    expect(result.cargo?.enabled).toBe(true);
    expect(result.cargo?.paths).toEqual(['crates/core', 'crates/cli']);
  });
});

describe('NpmConfigSchema', () => {
  it('applies defaults', () => {
    const result = NpmConfigSchema.parse({});
    expect(result.enabled).toBe(true);
    expect(result.auth).toBe('auto');
    expect(result.provenance).toBe(true);
    expect(result.access).toBe('public');
    expect(result.registry).toBe('https://registry.npmjs.org');
    expect(result.copyFiles).toEqual(['LICENSE']);
    expect(result.tag).toBe('latest');
  });

  it('accepts valid access values', () => {
    expect(NpmConfigSchema.parse({ access: 'public' }).access).toBe('public');
    expect(NpmConfigSchema.parse({ access: 'restricted' }).access).toBe('restricted');
  });

  it('accepts valid auth values', () => {
    for (const auth of ['auto', 'oidc', 'token'] as const) {
      expect(NpmConfigSchema.parse({ auth }).auth).toBe(auth);
    }
  });
});

describe('CargoPublishConfigSchema', () => {
  it('applies defaults', () => {
    const result = CargoPublishConfigSchema.parse({});
    expect(result.enabled).toBe(false);
    expect(result.noVerify).toBe(false);
    expect(result.publishOrder).toEqual([]);
    expect(result.clean).toBe(false);
  });
});

describe('GitHubReleaseConfigSchema', () => {
  it('applies defaults', () => {
    const result = GitHubReleaseConfigSchema.parse({});
    expect(result.enabled).toBe(true);
    expect(result.draft).toBe(true);
    expect(result.generateNotes).toBe(true);
    expect(result.perPackage).toBe(false);
    expect(result.prerelease).toBe('auto');
  });

  it('accepts prerelease as boolean or auto', () => {
    expect(GitHubReleaseConfigSchema.parse({ prerelease: true }).prerelease).toBe(true);
    expect(GitHubReleaseConfigSchema.parse({ prerelease: false }).prerelease).toBe(false);
    expect(GitHubReleaseConfigSchema.parse({ prerelease: 'auto' }).prerelease).toBe('auto');
  });
});

describe('VerifyConfigSchema', () => {
  it('applies defaults', () => {
    const result = VerifyConfigSchema.parse({});
    expect(result.npm.enabled).toBe(true);
    expect(result.npm.maxAttempts).toBe(5);
    expect(result.cargo.enabled).toBe(true);
    expect(result.cargo.maxAttempts).toBe(10);
  });
});

describe('PublishConfigSchema', () => {
  it('applies defaults for npm and cargo', () => {
    const result = PublishConfigSchema.parse({});
    expect(result.npm.enabled).toBe(true);
    expect(result.cargo.enabled).toBe(false);
    expect(result.githubRelease.enabled).toBe(true);
  });
});

describe('OutputConfigSchema', () => {
  it('requires format', () => {
    const result = OutputConfigSchema.parse({ format: 'markdown' });
    expect(result.format).toBe('markdown');
  });

  it('accepts all format values', () => {
    for (const format of ['markdown', 'github-release', 'json'] as const) {
      expect(OutputConfigSchema.parse({ format }).format).toBe(format);
    }
  });

  it('accepts optional file and options', () => {
    const result = OutputConfigSchema.parse({
      format: 'markdown',
      file: 'CHANGELOG.md',
      options: { header: 'Changelog' },
    });
    expect(result.file).toBe('CHANGELOG.md');
    expect(result.options).toEqual({ header: 'Changelog' });
  });
});

describe('LLMConfigSchema', () => {
  it('requires provider and model', () => {
    const result = LLMConfigSchema.parse({ provider: 'openai', model: 'gpt-4' });
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-4');
  });

  it('accepts optional fields', () => {
    const result = LLMConfigSchema.parse({
      provider: 'openai',
      model: 'gpt-4',
      baseURL: 'https://api.custom.com',
      apiKey: 'sk-test',
      concurrency: 5,
      options: {
        timeout: 30000,
        maxTokens: 1000,
        temperature: 0.7,
      },
      retry: {
        maxAttempts: 3,
        initialDelay: 1000,
      },
      tasks: {
        summarize: true,
        enhance: false,
      },
    });
    expect(result.baseURL).toBe('https://api.custom.com');
    expect(result.apiKey).toBe('sk-test');
    expect(result.concurrency).toBe(5);
    expect(result.options?.timeout).toBe(30000);
    expect(result.retry?.maxAttempts).toBe(3);
    expect(result.tasks?.summarize).toBe(true);
  });
});

describe('TemplateConfigSchema', () => {
  it('accepts empty object', () => {
    const result = TemplateConfigSchema.parse({});
    expect(result).toEqual({});
  });

  it('accepts valid engine values', () => {
    for (const engine of ['handlebars', 'liquid', 'ejs'] as const) {
      const result = TemplateConfigSchema.parse({ engine });
      expect(result.engine).toBe(engine);
    }
  });
});

describe('NotesConfigSchema', () => {
  it('applies defaults', () => {
    const result = NotesConfigSchema.parse({});
    expect(result.updateStrategy).toBe('prepend');
    expect(result.output).toEqual([{ format: 'markdown', file: 'CHANGELOG.md' }]);
  });
});

describe('ReleaseKitConfigSchema', () => {
  it('accepts empty object', () => {
    const result = ReleaseKitConfigSchema.parse({});
    expect(result).toEqual({});
  });

  it('accepts all sections', () => {
    const result = ReleaseKitConfigSchema.parse({
      git: { remote: 'origin' },
      monorepo: { mode: 'packages' },
      version: { preset: 'conventional' },
      publish: { npm: { enabled: true } },
      notes: { updateStrategy: 'prepend' },
    });
    expect(result.git?.remote).toBe('origin');
    expect(result.monorepo?.mode).toBe('packages');
    expect(result.version?.preset).toBe('conventional');
    expect(result.publish?.npm.enabled).toBe(true);
    expect(result.notes?.updateStrategy).toBe('prepend');
  });

  it('rejects invalid nested values', () => {
    expect(() =>
      ReleaseKitConfigSchema.parse({
        version: { versionStrategy: 'invalid' },
      }),
    ).toThrow();
  });
});
