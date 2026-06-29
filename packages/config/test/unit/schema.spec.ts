import { describe, expect, it } from 'vitest';
import {
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

  it('should accept rootPath and packagesPath', () => {
    const result = MonorepoConfigSchema.parse({ rootPath: 'CHANGELOG.md', packagesPath: 'packages' });
    expect(result.rootPath).toBe('CHANGELOG.md');
    expect(result.packagesPath).toBe('packages');
  });
});

describe('VersionConfigSchema', () => {
  it('should apply defaults', () => {
    const result = VersionConfigSchema.parse({});
    // biome-ignore lint/suspicious/noTemplateCurlyInString: checking the literal default string
    expect(result.tagTemplate).toBe('${prefix}${version}');
    expect(result.packageSpecificTags).toBe(false);
    expect(result.preset).toBe('conventional');
    expect(result.sync).toBe(true);
    expect(result.packages).toEqual([]);
    expect(result.mismatchStrategy).toBe('warn');
    expect(result.versionPrefix).toBe('');
    expect(result.zeroMajor).toBe('spec');
  });

  it("should accept zeroMajor: 'strict'", () => {
    const result = VersionConfigSchema.parse({ zeroMajor: 'strict' });
    expect(result.zeroMajor).toBe('strict');
  });

  it('should reject an unknown zeroMajor value', () => {
    expect(() => VersionConfigSchema.parse({ zeroMajor: 'always' })).toThrow();
  });

  it('should accept a baselineTagTemplate that contains ${version}', () => {
    const result = VersionConfigSchema.parse({ baselineTagTemplate: 'release/${' + 'prefix}${' + 'version}' });
    expect(result.baselineTagTemplate).toBe('release/${' + 'prefix}${' + 'version}');
  });

  it('should reject a baselineTagTemplate without ${version}', () => {
    expect(() => VersionConfigSchema.parse({ baselineTagTemplate: 'release/v' })).toThrow(/\$\{version\}/);
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

  it('should accept version groups with fixed and linked sync modes', () => {
    const result = VersionConfigSchema.parse({
      sync: false,
      groups: {
        native: { packages: ['@wdio/native-*'], sync: 'linked' },
        ui: { packages: ['@app/ui', '@app/ui-icons'], sync: 'fixed' },
      },
    });
    expect(result.groups?.native).toEqual({ packages: ['@wdio/native-*'], sync: 'linked' });
    expect(result.groups?.ui.sync).toBe('fixed');
  });

  it('should reject a group with an empty packages list', () => {
    expect(() =>
      VersionConfigSchema.parse({
        groups: { native: { packages: [], sync: 'fixed' } },
      }),
    ).toThrow();
  });

  it('should reject a group with an invalid sync mode', () => {
    expect(() =>
      VersionConfigSchema.parse({
        groups: { native: { packages: ['@wdio/native-*'], sync: 'frozen' } },
      }),
    ).toThrow();
  });

  it('should accept an independent group', () => {
    const result = VersionConfigSchema.parse({
      sync: false,
      groups: { native: { packages: ['@wdio/native-*'], sync: 'independent' } },
    });
    expect(result.groups?.native.sync).toBe('independent');
  });

  it('should leave groups undefined when not specified', () => {
    expect(VersionConfigSchema.parse({}).groups).toBeUndefined();
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
    expect(result.body).toBe('auto');
  });

  it('should accept prerelease as boolean or auto', () => {
    expect(GitHubReleaseConfigSchema.parse({ prerelease: true }).prerelease).toBe(true);
    expect(GitHubReleaseConfigSchema.parse({ prerelease: false }).prerelease).toBe(false);
    expect(GitHubReleaseConfigSchema.parse({ prerelease: 'auto' }).prerelease).toBe('auto');
  });

  it('should accept body as auto, releaseNotes, changelog, generated, or none', () => {
    const result = GitHubReleaseConfigSchema.parse({ body: 'auto' });
    expect(result.body).toBe('auto');

    for (const body of ['releaseNotes', 'changelog', 'generated', 'none'] as const) {
      expect(GitHubReleaseConfigSchema.parse({ body }).body).toBe(body);
    }
  });

  it('should default to auto', () => {
    const result = GitHubReleaseConfigSchema.parse({});
    expect(result.body).toBe('auto');
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
  });

  it('should accept allowed scopes', () => {
    const result = ScopeRulesSchema.parse({
      allowed: ['CI', 'Dependencies'],
    });
    expect(result.allowed).toEqual(['CI', 'Dependencies']);
  });

  it('should accept caseSensitive flag', () => {
    const result = ScopeRulesSchema.parse({ caseSensitive: true });
    expect(result.caseSensitive).toBe(true);
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

  it('should accept instructions only (templates removed)', () => {
    const result = LLMPromptsConfigSchema.parse({
      instructions: { enhance: 'Use active voice' },
    });
    expect(result.instructions?.enhance).toBe('Use active voice');
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
        rules: { allowed: ['CI', 'Dependencies'] },
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
      },
    });
    expect(result.prompts?.instructions?.categorize).toBe('Custom instruction');
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
  it('should accept empty object', () => {
    const result = NotesConfigSchema.parse({});
    expect(result.changelog).toBeUndefined();
    expect(result.releaseNotes).toBeUndefined();
  });

  it('should accept changelog with mode', () => {
    const result = NotesConfigSchema.parse({ changelog: { mode: 'packages' } });
    expect(result.changelog).toMatchObject({ mode: 'packages' });
  });

  it('should accept false to disable changelog', () => {
    const result = NotesConfigSchema.parse({ changelog: false });
    expect(result.changelog).toBe(false);
  });

  it('should accept changelog with file name override', () => {
    const result = NotesConfigSchema.parse({ changelog: { mode: 'root', file: 'CHANGES.md' } });
    expect(result.changelog).toMatchObject({ mode: 'root', file: 'CHANGES.md' });
  });

  it('should accept releaseNotes with file output (dir) and default the directory', () => {
    const result = NotesConfigSchema.parse({ releaseNotes: { file: {} } });
    expect(result.releaseNotes).toMatchObject({ file: { dir: 'release-notes' } });
  });

  it('should accept false to disable releaseNotes', () => {
    const result = NotesConfigSchema.parse({ releaseNotes: false });
    expect(result.releaseNotes).toBe(false);
  });

  it('should accept releaseNotes with a custom file dir and templates', () => {
    const result = NotesConfigSchema.parse({
      releaseNotes: {
        file: { dir: 'docs/releases' },
        templates: { path: './templates/release.liquid', engine: 'liquid' },
      },
    });
    expect(result.releaseNotes).toMatchObject({ file: { dir: 'docs/releases' } });
    expect((result.releaseNotes as { templates?: { path?: string } })?.templates?.path).toBe(
      './templates/release.liquid',
    );
  });
});

describe('CIConfigSchema', () => {
  it('should apply defaults', () => {
    const result = CIConfigSchema.parse({});
    expect(result.releaseStrategy).toBe('direct');
    expect(result.releaseTrigger).toBe('label');
    expect(result.prPreview).toEqual({ enabled: true, refreshAfterRelease: false });
    expect(result.labels).toEqual({
      graduate: 'release:graduate',
      graduatePackagePrefix: 'graduate:',
      prerelease: 'channel:prerelease',
      skip: 'release:skip',
      immediate: 'release:immediate',
      retry: 'release:retry',
      previewNotes: 'release:preview-notes',
      major: 'bump:major',
      minor: 'bump:minor',
      patch: 'bump:patch',
      withPrerequisites: 'release:with-prerequisites',
    });
  });

  it('should accept valid values', () => {
    const result = CIConfigSchema.parse({
      releaseStrategy: 'direct',
      prPreview: false,
    });
    expect(result.releaseStrategy).toBe('direct');
    expect(result.prPreview).toEqual({ enabled: false, refreshAfterRelease: false });
  });

  it('should accept all releaseStrategy values', () => {
    for (const strategy of ['manual', 'direct', 'standing-pr'] as const) {
      expect(CIConfigSchema.parse({ releaseStrategy: strategy }).releaseStrategy).toBe(strategy);
    }
  });

  it('should normalize prPreview: true to the canonical object', () => {
    expect(CIConfigSchema.parse({ prPreview: true }).prPreview).toEqual({
      enabled: true,
      refreshAfterRelease: false,
    });
  });

  it('should normalize prPreview: false to the canonical object (shorthand kept)', () => {
    expect(CIConfigSchema.parse({ prPreview: false }).prPreview).toEqual({
      enabled: false,
      refreshAfterRelease: false,
    });
  });

  it('should default an empty prPreview object to enabled with refresh off', () => {
    expect(CIConfigSchema.parse({ prPreview: {} }).prPreview).toEqual({
      enabled: true,
      refreshAfterRelease: false,
    });
  });

  it('should honor prPreview.refreshAfterRelease in the object form', () => {
    expect(CIConfigSchema.parse({ prPreview: { refreshAfterRelease: true } }).prPreview).toEqual({
      enabled: true,
      refreshAfterRelease: true,
    });
  });

  it('should allow disabling previews while the object form is used', () => {
    expect(CIConfigSchema.parse({ prPreview: { enabled: false } }).prPreview).toEqual({
      enabled: false,
      refreshAfterRelease: false,
    });
  });

  it('should reject invalid releaseStrategy', () => {
    expect(() => CIConfigSchema.parse({ releaseStrategy: 'invalid' })).toThrow();
  });

  it('should accept usernames and @org/team entries in standingPr.authorization.allowedActors', () => {
    const result = CIConfigSchema.parse({
      standingPr: { authorization: { allowedActors: ['octocat', 'release-bot', '@acme/releasers'] } },
    });
    expect(result.standingPr?.authorization?.allowedActors).toEqual(['octocat', 'release-bot', '@acme/releasers']);
  });

  it('should reject an allowedActors entry like "@octocat" (an @-prefix without the team slash)', () => {
    expect(() => CIConfigSchema.parse({ standingPr: { authorization: { allowedActors: ['@octocat'] } } })).toThrow();
  });

  it('should accept all releaseTrigger values', () => {
    for (const trigger of ['commit', 'label'] as const) {
      expect(CIConfigSchema.parse({ releaseTrigger: trigger }).releaseTrigger).toBe(trigger);
    }
  });

  it('should reject invalid releaseTrigger', () => {
    expect(() => CIConfigSchema.parse({ releaseTrigger: 'invalid' })).toThrow();
  });

  it('should accept custom label names', () => {
    const result = CIConfigSchema.parse({
      labels: {
        graduate: 'graduate',
        prerelease: 'pre',
        skip: 'no-release',
        major: 'breaking',
        minor: 'feat',
        patch: 'fix',
      },
    });
    expect(result.labels.graduate).toBe('graduate');
    expect(result.labels.prerelease).toBe('pre');
    expect(result.labels.skip).toBe('no-release');
    expect(result.labels.major).toBe('breaking');
    expect(result.labels.minor).toBe('feat');
    expect(result.labels.patch).toBe('fix');
  });

  it('should apply label defaults for partial labels config', () => {
    const result = CIConfigSchema.parse({ labels: { graduate: 'custom-graduate' } });
    expect(result.labels.graduate).toBe('custom-graduate');
    expect(result.labels.prerelease).toBe('channel:prerelease');
    expect(result.labels.skip).toBe('release:skip');
    expect(result.labels.major).toBe('bump:major');
    expect(result.labels.minor).toBe('bump:minor');
    expect(result.labels.patch).toBe('bump:patch');
  });

  it('should parse scopeLabels as a string-to-string map', () => {
    const result = CIConfigSchema.parse({
      scopeLabels: {
        'scope:all': '@releasekit/*',
        'scope:cli': 'packages/release',
      },
    });
    expect(result.scopeLabels).toEqual({
      'scope:all': '@releasekit/*',
      'scope:cli': 'packages/release',
    });
  });

  it('should leave scopeLabels undefined when omitted', () => {
    expect(CIConfigSchema.parse({}).scopeLabels).toBeUndefined();
  });

  it('should reject non-string scopeLabels values', () => {
    expect(() => CIConfigSchema.parse({ scopeLabels: { 'scope:all': 123 } })).toThrow();
  });

  it('should return undefined for standingPr when omitted', () => {
    const result = CIConfigSchema.parse({});
    expect(result.standingPr).toBeUndefined();
  });

  it('should apply standingPr defaults when provided as empty object', () => {
    const result = CIConfigSchema.parse({ standingPr: {} });
    expect(result.standingPr?.branch).toBe('release/next');
    // No schema default — the title default is strategy-dependent, resolved at use site
    expect(result.standingPr?.title).toBeUndefined();
    expect(result.standingPr?.labels).toEqual(['release']);
    expect(result.standingPr?.deleteBranchOnMerge).toBe(true);
  });

  it('should respect explicit standingPr overrides', () => {
    const result = CIConfigSchema.parse({
      standingPr: {
        branch: 'release/staging',
        title: 'chore: release ${count} pkg(s)',
        labels: ['auto-release'],
        deleteBranchOnMerge: false,
      },
    });
    expect(result.standingPr?.branch).toBe('release/staging');
    expect(result.standingPr?.title).toBe('chore: release ${count} pkg(s)');
    expect(result.standingPr?.labels).toEqual(['auto-release']);
    expect(result.standingPr?.deleteBranchOnMerge).toBe(false);
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
      monorepo: { rootPath: 'CHANGELOG.md' },
      version: { preset: 'conventional' },
      publish: { npm: { enabled: true } },
      notes: { changelog: { mode: 'packages' } },
      ci: { prPreview: true },
    });
    expect(result.git?.remote).toBe('origin');
    expect(result.monorepo?.rootPath).toBe('CHANGELOG.md');
    expect(result.version?.preset).toBe('conventional');
    expect(result.publish?.npm.enabled).toBe(true);
    expect(result.notes?.changelog).toMatchObject({ mode: 'packages' });
    expect(result.ci?.prPreview).toEqual({ enabled: true, refreshAfterRelease: false });
  });

  it('should reject invalid nested values', () => {
    expect(() =>
      ReleaseKitConfigSchema.parse({
        version: { zeroMajor: 'invalid' },
      }),
    ).toThrow();
  });
});
