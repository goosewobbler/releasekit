import { describe, expect, it } from 'vitest';
import {
  BranchPatternSchema,
  CargoPublishConfigSchema,
  CIConfigSchema,
  GitConfigSchema,
  GitHubReleaseConfigSchema,
  LLMCategorySchema,
  LLMConfigSchema,
  LLMPromptsConfigSchema,
  MonorepoConfigSchema,
  NotesConfigSchema,
  NpmConfigSchema,
  OutputConfigSchema,
  PublishConfigSchema,
  ReleaseKitConfigSchema,
  ScopeConfigSchema,
  ScopeRulesSchema,
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
    expect(result.perPackage).toBe(true);
    expect(result.prerelease).toBe('auto');
    expect(result.releaseNotes).toBe('auto');
  });

  it('accepts prerelease as boolean or auto', () => {
    expect(GitHubReleaseConfigSchema.parse({ prerelease: true }).prerelease).toBe(true);
    expect(GitHubReleaseConfigSchema.parse({ prerelease: false }).prerelease).toBe(false);
    expect(GitHubReleaseConfigSchema.parse({ prerelease: 'auto' }).prerelease).toBe('auto');
  });

  it('accepts releaseNotes as auto, github, none, or file path', () => {
    expect(GitHubReleaseConfigSchema.parse({ releaseNotes: 'auto' }).releaseNotes).toBe('auto');
    expect(GitHubReleaseConfigSchema.parse({ releaseNotes: 'github' }).releaseNotes).toBe('github');
    expect(GitHubReleaseConfigSchema.parse({ releaseNotes: 'none' }).releaseNotes).toBe('none');
    expect(GitHubReleaseConfigSchema.parse({ releaseNotes: './RELEASE_NOTES.md' }).releaseNotes).toBe(
      './RELEASE_NOTES.md',
    );
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

  it('accepts per-output templates', () => {
    const result = OutputConfigSchema.parse({
      format: 'markdown',
      file: 'RELEASE_NOTES.md',
      templates: { path: './templates/release.liquid', engine: 'liquid' },
    });
    expect(result.templates?.path).toBe('./templates/release.liquid');
    expect(result.templates?.engine).toBe('liquid');
  });
});

describe('LLMCategorySchema', () => {
  it('requires name and description', () => {
    const result = LLMCategorySchema.parse({ name: 'New', description: 'New features' });
    expect(result.name).toBe('New');
    expect(result.description).toBe('New features');
  });

  it('accepts optional scopes array', () => {
    const result = LLMCategorySchema.parse({
      name: 'Developer',
      description: 'Internal changes',
      scopes: ['CI', 'Dependencies', 'Testing'],
    });
    expect(result.scopes).toEqual(['CI', 'Dependencies', 'Testing']);
  });

  it('allows empty scopes array', () => {
    const result = LLMCategorySchema.parse({ name: 'New', description: 'Features', scopes: [] });
    expect(result.scopes).toEqual([]);
  });
});

describe('ScopeRulesSchema', () => {
  it('applies defaults', () => {
    const result = ScopeRulesSchema.parse({});
    expect(result.caseSensitive).toBe(false);
    expect(result.invalidScopeAction).toBe('remove');
  });

  it('accepts all invalidScopeAction values', () => {
    for (const action of ['remove', 'keep', 'fallback'] as const) {
      expect(ScopeRulesSchema.parse({ invalidScopeAction: action }).invalidScopeAction).toBe(action);
    }
  });

  it('accepts allowed scopes and fallbackScope', () => {
    const result = ScopeRulesSchema.parse({
      allowed: ['CI', 'Dependencies'],
      fallbackScope: 'Other',
    });
    expect(result.allowed).toEqual(['CI', 'Dependencies']);
    expect(result.fallbackScope).toBe('Other');
  });

  it('rejects invalid invalidScopeAction', () => {
    expect(() => ScopeRulesSchema.parse({ invalidScopeAction: 'invalid' })).toThrow();
  });
});

describe('ScopeConfigSchema', () => {
  it('defaults mode to unrestricted', () => {
    const result = ScopeConfigSchema.parse({});
    expect(result.mode).toBe('unrestricted');
  });

  it('accepts all mode values', () => {
    for (const mode of ['restricted', 'packages', 'none', 'unrestricted'] as const) {
      expect(ScopeConfigSchema.parse({ mode }).mode).toBe(mode);
    }
  });

  it('accepts optional rules', () => {
    const result = ScopeConfigSchema.parse({
      mode: 'restricted',
      rules: { allowed: ['CI'], caseSensitive: true },
    });
    expect(result.rules?.allowed).toEqual(['CI']);
    expect(result.rules?.caseSensitive).toBe(true);
  });

  it('rejects invalid mode', () => {
    expect(() => ScopeConfigSchema.parse({ mode: 'invalid' })).toThrow();
  });
});

describe('LLMPromptsConfigSchema', () => {
  it('accepts empty object', () => {
    const result = LLMPromptsConfigSchema.parse({});
    expect(result).toEqual({});
  });

  it('accepts instructions for all task types', () => {
    const result = LLMPromptsConfigSchema.parse({
      instructions: {
        enhance: 'Use active voice',
        categorize: 'Prefer Developer for CI',
        enhanceAndCategorize: 'Combined instructions',
        summarize: 'Keep it brief',
        releaseNotes: 'Blog style',
      },
    });
    expect(result.instructions?.enhance).toBe('Use active voice');
    expect(result.instructions?.releaseNotes).toBe('Blog style');
  });

  it('accepts templates for task types', () => {
    const result = LLMPromptsConfigSchema.parse({
      templates: { categorize: 'Custom prompt: {{entries}}' },
    });
    expect(result.templates?.categorize).toBe('Custom prompt: {{entries}}');
  });

  it('accepts both instructions and templates', () => {
    const result = LLMPromptsConfigSchema.parse({
      instructions: { enhance: 'Use active voice' },
      templates: { categorize: 'Custom prompt' },
    });
    expect(result.instructions?.enhance).toBe('Use active voice');
    expect(result.templates?.categorize).toBe('Custom prompt');
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

  it('accepts scopes config', () => {
    const result = LLMConfigSchema.parse({
      provider: 'openai',
      model: 'gpt-4',
      scopes: {
        mode: 'restricted',
        rules: { allowed: ['CI', 'Dependencies'], invalidScopeAction: 'remove' },
      },
    });
    expect(result.scopes?.mode).toBe('restricted');
    expect(result.scopes?.rules?.allowed).toEqual(['CI', 'Dependencies']);
  });

  it('accepts prompts config', () => {
    const result = LLMConfigSchema.parse({
      provider: 'openai',
      model: 'gpt-4',
      prompts: {
        instructions: { categorize: 'Custom instruction' },
        templates: { releaseNotes: 'Full custom prompt' },
      },
    });
    expect(result.prompts?.instructions?.categorize).toBe('Custom instruction');
    expect(result.prompts?.templates?.releaseNotes).toBe('Full custom prompt');
  });

  it('accepts categories with scopes', () => {
    const result = LLMConfigSchema.parse({
      provider: 'openai',
      model: 'gpt-4',
      categories: [
        { name: 'Developer', description: 'Internal', scopes: ['CI', 'Testing'] },
        { name: 'New', description: 'Features' },
      ],
    });
    expect(result.categories?.[0]?.scopes).toEqual(['CI', 'Testing']);
    expect(result.categories?.[1]?.scopes).toBeUndefined();
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

describe('CIConfigSchema', () => {
  it('applies defaults', () => {
    const result = CIConfigSchema.parse({});
    expect(result.releaseStrategy).toBe('manual');
    expect(result.prPreview).toBe(true);
    expect(result.autoRelease).toBe(false);
    expect(result.skipPatterns).toEqual([]);
    expect(result.minChanges).toBe(1);
    expect(result.labels).toEqual({
      stable: 'release:stable',
      prerelease: 'release:prerelease',
      skip: 'release:skip',
      major: 'release:major',
    });
  });

  it('accepts valid values', () => {
    const result = CIConfigSchema.parse({
      releaseStrategy: 'direct',
      prPreview: false,
      autoRelease: true,
      skipPatterns: ['chore(deps):', 'ci:'],
      minChanges: 3,
    });
    expect(result.releaseStrategy).toBe('direct');
    expect(result.prPreview).toBe(false);
    expect(result.autoRelease).toBe(true);
    expect(result.skipPatterns).toEqual(['chore(deps):', 'ci:']);
    expect(result.minChanges).toBe(3);
  });

  it('accepts all releaseStrategy values', () => {
    for (const strategy of ['manual', 'direct', 'standing-pr', 'scheduled'] as const) {
      expect(CIConfigSchema.parse({ releaseStrategy: strategy }).releaseStrategy).toBe(strategy);
    }
  });

  it('rejects invalid releaseStrategy', () => {
    expect(() => CIConfigSchema.parse({ releaseStrategy: 'invalid' })).toThrow();
  });

  it('rejects non-positive minChanges', () => {
    expect(() => CIConfigSchema.parse({ minChanges: 0 })).toThrow();
    expect(() => CIConfigSchema.parse({ minChanges: -1 })).toThrow();
  });

  it('accepts custom label names', () => {
    const result = CIConfigSchema.parse({
      labels: { stable: 'stable', prerelease: 'pre', skip: 'no-release', major: 'breaking' },
    });
    expect(result.labels.stable).toBe('stable');
    expect(result.labels.prerelease).toBe('pre');
    expect(result.labels.skip).toBe('no-release');
    expect(result.labels.major).toBe('breaking');
  });

  it('applies label defaults for partial labels config', () => {
    const result = CIConfigSchema.parse({ labels: { stable: 'custom-stable' } });
    expect(result.labels.stable).toBe('custom-stable');
    expect(result.labels.prerelease).toBe('release:prerelease');
    expect(result.labels.skip).toBe('release:skip');
    expect(result.labels.major).toBe('release:major');
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
      ci: { prPreview: true, autoRelease: false },
    });
    expect(result.git?.remote).toBe('origin');
    expect(result.monorepo?.mode).toBe('packages');
    expect(result.version?.preset).toBe('conventional');
    expect(result.publish?.npm.enabled).toBe(true);
    expect(result.notes?.updateStrategy).toBe('prepend');
    expect(result.ci?.prPreview).toBe(true);
    expect(result.ci?.autoRelease).toBe(false);
  });

  it('rejects invalid nested values', () => {
    expect(() =>
      ReleaseKitConfigSchema.parse({
        version: { versionStrategy: 'invalid' },
      }),
    ).toThrow();
  });
});
