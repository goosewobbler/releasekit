import { describe, expect, it } from 'vitest';
import {
  BranchPatternSchema,
  CargoPublishConfigSchema,
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
  ReleaseConfigSchema,
  ReleaseKitConfigSchema,
  ScopeConfigSchema,
  ScopeRulesSchema,
  TemplateConfigSchema,
  VerifyConfigSchema,
  VersionConfigSchema,
} from '../../src/schema.js';

describe('GitConfigSchema', () => {
  it('should apply defaults for missing fields', () => {
    const result = GitConfigSchema.parse({});
    expect(result).toEqual({
      remote: 'origin',
      branch: 'main',
      pushMethod: 'auto',
    });
  });

  it('should accept valid values', () => {
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

  it('should reject invalid pushMethod', () => {
    expect(() => GitConfigSchema.parse({ pushMethod: 'invalid' })).toThrow();
  });
});

describe('MonorepoConfigSchema', () => {
  it('should accept empty object', () => {
    const result = MonorepoConfigSchema.parse({});
    expect(result).toEqual({});
  });

  it('should accept valid mode values', () => {
    for (const mode of ['root', 'packages', 'both'] as const) {
      const result = MonorepoConfigSchema.parse({ mode });
      expect(result.mode).toBe(mode);
    }
  });

  it('should reject invalid mode', () => {
    expect(() => MonorepoConfigSchema.parse({ mode: 'invalid' })).toThrow();
  });
});

describe('BranchPatternSchema', () => {
  it('should require pattern and releaseType', () => {
    const result = BranchPatternSchema.parse({
      pattern: 'release/*',
      releaseType: 'minor',
    });
    expect(result.pattern).toBe('release/*');
    expect(result.releaseType).toBe('minor');
  });

  it('should reject invalid releaseType', () => {
    expect(() =>
      BranchPatternSchema.parse({
        pattern: 'release/*',
        releaseType: 'invalid',
      }),
    ).toThrow();
  });
});

describe('VersionConfigSchema', () => {
  it('should apply defaults', () => {
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

  it('should accept branchPatterns', () => {
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

  it('should accept cargo config', () => {
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
  it('should apply defaults', () => {
    const result = NpmConfigSchema.parse({});
    expect(result.enabled).toBe(true);
    expect(result.auth).toBe('auto');
    expect(result.provenance).toBe(true);
    expect(result.access).toBe('public');
    expect(result.registry).toBe('https://registry.npmjs.org');
    expect(result.copyFiles).toEqual(['LICENSE']);
    expect(result.tag).toBe('latest');
  });

  it('should accept valid access values', () => {
    expect(NpmConfigSchema.parse({ access: 'public' }).access).toBe('public');
    expect(NpmConfigSchema.parse({ access: 'restricted' }).access).toBe('restricted');
  });

  it('should accept valid auth values', () => {
    for (const auth of ['auto', 'oidc', 'token'] as const) {
      expect(NpmConfigSchema.parse({ auth }).auth).toBe(auth);
    }
  });
});

describe('CargoPublishConfigSchema', () => {
  it('should apply defaults', () => {
    const result = CargoPublishConfigSchema.parse({});
    expect(result.enabled).toBe(false);
    expect(result.noVerify).toBe(false);
    expect(result.publishOrder).toEqual([]);
    expect(result.clean).toBe(false);
  });
});

describe('GitHubReleaseConfigSchema', () => {
  it('should apply defaults', () => {
    const result = GitHubReleaseConfigSchema.parse({});
    expect(result.enabled).toBe(true);
    expect(result.draft).toBe(true);
    expect(result.perPackage).toBe(true);
    expect(result.prerelease).toBe('auto');
    expect(result.releaseNotes).toBe('auto');
  });

  it('should accept prerelease as boolean or auto', () => {
    expect(GitHubReleaseConfigSchema.parse({ prerelease: true }).prerelease).toBe(true);
    expect(GitHubReleaseConfigSchema.parse({ prerelease: false }).prerelease).toBe(false);
    expect(GitHubReleaseConfigSchema.parse({ prerelease: 'auto' }).prerelease).toBe('auto');
  });

  it('should accept releaseNotes as auto, github, none, or file path', () => {
    expect(GitHubReleaseConfigSchema.parse({ releaseNotes: 'auto' }).releaseNotes).toBe('auto');
    expect(GitHubReleaseConfigSchema.parse({ releaseNotes: 'github' }).releaseNotes).toBe('github');
    expect(GitHubReleaseConfigSchema.parse({ releaseNotes: 'none' }).releaseNotes).toBe('none');
    expect(GitHubReleaseConfigSchema.parse({ releaseNotes: './RELEASE_NOTES.md' }).releaseNotes).toBe(
      './RELEASE_NOTES.md',
    );
  });
});

describe('VerifyConfigSchema', () => {
  it('should apply defaults', () => {
    const result = VerifyConfigSchema.parse({});
    expect(result.npm.enabled).toBe(true);
    expect(result.npm.maxAttempts).toBe(5);
    expect(result.cargo.enabled).toBe(true);
    expect(result.cargo.maxAttempts).toBe(10);
  });
});

describe('PublishConfigSchema', () => {
  it('should apply defaults for npm and cargo', () => {
    const result = PublishConfigSchema.parse({});
    expect(result.npm.enabled).toBe(true);
    expect(result.cargo.enabled).toBe(false);
    expect(result.githubRelease.enabled).toBe(true);
  });
});

describe('OutputConfigSchema', () => {
  it('should require format', () => {
    const result = OutputConfigSchema.parse({ format: 'markdown' });
    expect(result.format).toBe('markdown');
  });

  it('should accept all format values', () => {
    for (const format of ['markdown', 'github-release', 'json'] as const) {
      expect(OutputConfigSchema.parse({ format }).format).toBe(format);
    }
  });

  it('should accept optional file and options', () => {
    const result = OutputConfigSchema.parse({
      format: 'markdown',
      file: 'CHANGELOG.md',
      options: { header: 'Changelog' },
    });
    expect(result.file).toBe('CHANGELOG.md');
    expect(result.options).toEqual({ header: 'Changelog' });
  });

  it('should accept per-output templates', () => {
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
  it('should require name and description', () => {
    const result = LLMCategorySchema.parse({ name: 'New', description: 'New features' });
    expect(result.name).toBe('New');
    expect(result.description).toBe('New features');
  });

  it('should accept optional scopes array', () => {
    const result = LLMCategorySchema.parse({
      name: 'Developer',
      description: 'Internal changes',
      scopes: ['CI', 'Dependencies', 'Testing'],
    });
    expect(result.scopes).toEqual(['CI', 'Dependencies', 'Testing']);
  });

  it('should allow empty scopes array', () => {
    const result = LLMCategorySchema.parse({ name: 'New', description: 'Features', scopes: [] });
    expect(result.scopes).toEqual([]);
  });
});

describe('ScopeRulesSchema', () => {
  it('should apply defaults', () => {
    const result = ScopeRulesSchema.parse({});
    expect(result.caseSensitive).toBe(false);
    expect(result.invalidScopeAction).toBe('remove');
  });

  it('should accept all invalidScopeAction values', () => {
    for (const action of ['remove', 'keep', 'fallback'] as const) {
      expect(ScopeRulesSchema.parse({ invalidScopeAction: action }).invalidScopeAction).toBe(action);
    }
  });

  it('should accept allowed scopes and fallbackScope', () => {
    const result = ScopeRulesSchema.parse({
      allowed: ['CI', 'Dependencies'],
      fallbackScope: 'Other',
    });
    expect(result.allowed).toEqual(['CI', 'Dependencies']);
    expect(result.fallbackScope).toBe('Other');
  });

  it('should reject invalid invalidScopeAction', () => {
    expect(() => ScopeRulesSchema.parse({ invalidScopeAction: 'invalid' })).toThrow();
  });
});

describe('ScopeConfigSchema', () => {
  it('should default mode to unrestricted', () => {
    const result = ScopeConfigSchema.parse({});
    expect(result.mode).toBe('unrestricted');
  });

  it('should accept all mode values', () => {
    for (const mode of ['restricted', 'packages', 'none', 'unrestricted'] as const) {
      expect(ScopeConfigSchema.parse({ mode }).mode).toBe(mode);
    }
  });

  it('should accept optional rules', () => {
    const result = ScopeConfigSchema.parse({
      mode: 'restricted',
      rules: { allowed: ['CI'], caseSensitive: true },
    });
    expect(result.rules?.allowed).toEqual(['CI']);
    expect(result.rules?.caseSensitive).toBe(true);
  });

  it('should reject invalid mode', () => {
    expect(() => ScopeConfigSchema.parse({ mode: 'invalid' })).toThrow();
  });
});

describe('LLMPromptsConfigSchema', () => {
  it('should accept empty object', () => {
    const result = LLMPromptsConfigSchema.parse({});
    expect(result).toEqual({});
  });

  it('should accept instructions for all task types', () => {
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

  it('should accept templates for task types', () => {
    const result = LLMPromptsConfigSchema.parse({
      templates: { categorize: 'Custom prompt: {{entries}}' },
    });
    expect(result.templates?.categorize).toBe('Custom prompt: {{entries}}');
  });

  it('should accept both instructions and templates', () => {
    const result = LLMPromptsConfigSchema.parse({
      instructions: { enhance: 'Use active voice' },
      templates: { categorize: 'Custom prompt' },
    });
    expect(result.instructions?.enhance).toBe('Use active voice');
    expect(result.templates?.categorize).toBe('Custom prompt');
  });
});

describe('LLMConfigSchema', () => {
  it('should require provider and model', () => {
    const result = LLMConfigSchema.parse({ provider: 'openai', model: 'gpt-4' });
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-4');
  });

  it('should accept optional fields', () => {
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

  it('should accept scopes config', () => {
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

  it('should accept prompts config', () => {
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

  it('should accept categories with scopes', () => {
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
  it('should accept empty object', () => {
    const result = TemplateConfigSchema.parse({});
    expect(result).toEqual({});
  });

  it('should accept valid engine values', () => {
    for (const engine of ['handlebars', 'liquid', 'ejs'] as const) {
      const result = TemplateConfigSchema.parse({ engine });
      expect(result.engine).toBe(engine);
    }
  });
});

describe('NotesConfigSchema', () => {
  it('should apply defaults', () => {
    const result = NotesConfigSchema.parse({});
    expect(result.updateStrategy).toBe('prepend');
    expect(result.output).toEqual([{ format: 'markdown', file: 'CHANGELOG.md' }]);
  });
});

describe('ReleaseConfigSchema', () => {
  it('should accept valid steps array', () => {
    expect(ReleaseConfigSchema.parse({ steps: ['notes', 'publish'] }).steps).toEqual(['notes', 'publish']);
    expect(ReleaseConfigSchema.parse({ steps: ['notes'] }).steps).toEqual(['notes']);
    expect(ReleaseConfigSchema.parse({ steps: ['publish'] }).steps).toEqual(['publish']);
  });

  it('should reject an empty steps array', () => {
    expect(() => ReleaseConfigSchema.parse({ steps: [] })).toThrow();
  });

  it('should reject steps containing invalid values', () => {
    expect(() => ReleaseConfigSchema.parse({ steps: ['version'] })).toThrow();
    expect(() => ReleaseConfigSchema.parse({ steps: ['notes', 'invalid'] })).toThrow();
  });
});

describe('ReleaseKitConfigSchema', () => {
  it('should accept empty object', () => {
    const result = ReleaseKitConfigSchema.parse({});
    expect(result).toEqual({});
  });

  it('should accept all sections', () => {
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

  it('should reject invalid nested values', () => {
    expect(() =>
      ReleaseKitConfigSchema.parse({
        version: { versionStrategy: 'invalid' },
      }),
    ).toThrow();
  });
});
