import * as fs from 'node:fs';
import * as path from 'node:path';
import { debug, info, success, warn } from '@releasekit/core';
import { parseVersionOutput } from '../input/version-output.js';
import { fetchPullRequestContext, parseIssueNumbers, resolveGitHubToken } from '../llm/context/prFetcher.js';
import { LLM_DEFAULTS } from '../llm/defaults.js';
import { fetchExamples } from '../llm/examples/fetcher.js';
import type { Example, LLMProvider } from '../llm/index.js';
import {
  categorizeEntries,
  createProvider,
  enhanceAndCategorize,
  enhanceEntries,
  generateReleaseNotes,
  summarizeEntries,
} from '../llm/index.js';
import { type FormatVersionOptions, formatVersion, writeMarkdown } from '../output/markdown.js';
import { renderTemplate } from '../templates/index.js';
import { withRetry } from '../utils/retry.js';
import type {
  ChangelogInput,
  Config,
  DocumentContext,
  EnhancedCategory,
  EnhancedData,
  LLMCategory,
  LLMConfig,
  PackageChangelog,
  PRContext,
  TemplateContext,
  TemplateEngine,
} from './types.js';

function parseOwnerRepo(repoUrl: string): { owner: string; repo: string } | null {
  // SCP-style SSH: git@github.com:owner/repo.git — only github.com
  const scpMatch = repoUrl.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  if (scpMatch) return { owner: scpMatch[1]!, repo: scpMatch[2]! };

  try {
    const url = new URL(repoUrl);
    if (url.hostname !== 'github.com') return null;
    const parts = url.pathname
      .replace(/^\//, '')
      .replace(/\.git$/, '')
      .split('/');
    if (parts.length >= 2) return { owner: parts[0]!, repo: parts[1]! };
  } catch {
    // invalid URL
  }
  return null;
}

/**
 * For dash-format compound tags (e.g. "scope-pkg-1.2.3" or "scope-pkg-1.2.3-next.1"),
 * find the index of the '-' that separates the package prefix from the semver version.
 * Scans right-to-left so pre-release dashes (e.g. the '-' in "1.2.3-next.1") are skipped.
 * Returns -1 when no semver-like segment is found (plain version tag).
 */
function findCompoundTagSepPos(tag: string): number {
  let pos = tag.lastIndexOf('-');
  while (pos > 0) {
    const afterDash = pos + 1;
    if (tag.charCodeAt(afterDash) >= 48 && tag.charCodeAt(afterDash) <= 57) {
      // Digit after dash — confirm semver-like by requiring ≥2 dots in the remainder
      let dots = 0;
      for (let i = afterDash; i < tag.length; i++) {
        if (tag[i] === '.') dots++;
      }
      if (dots >= 2) return pos;
    }
    pos = tag.lastIndexOf('-', pos - 1);
  }
  return -1;
}

function generateCompareUrl(repoUrl: string, from: string, to: string, packageName?: string): string {
  // Check if using package-specific tags (from version contains @ and package name)
  const isPackageSpecific = from.includes('@') && packageName && from.includes(packageName);

  let fromVersion: string;
  let toVersion: string;

  if (isPackageSpecific) {
    // For package-specific tags, construct full tag format for both from and to
    // from: @releasekit/version@v0.2.0-next.9 -> keep as is
    // to: 0.2.0-next.10 -> @releasekit/version@v0.2.0-next.10
    fromVersion = from;
    toVersion = `${packageName}@${to.startsWith('v') ? '' : 'v'}${to}`;
  } else {
    // Detect compound tags like "scope-pkg-v1.2.3" (dash-format package-specific tags).
    // Use index-based string operations instead of regex to avoid ReDoS on inputs with
    // many repeated digits (polynomial backtracking with lazy + greedy quantifiers).
    const toClean = to.replace(/^v/, '');
    const dashVPos = from.lastIndexOf('-v');
    if (dashVPos > 0 && from.charCodeAt(dashVPos + 2) >= 48 && from.charCodeAt(dashVPos + 2) <= 57) {
      // "-v" followed by a digit → compound tag with explicit "v" prefix
      fromVersion = from;
      toVersion = `${from.slice(0, dashVPos + 1)}v${toClean}`;
    } else {
      const sepPos = findCompoundTagSepPos(from);
      if (sepPos > 0) {
        // Compound tag without "v" prefix (e.g. "scope-pkg-1.2.3" or "scope-pkg-1.2.3-next.1")
        fromVersion = from;
        toVersion = `${from.slice(0, sepPos + 1)}${toClean}`;
      } else {
        // Plain version tag (e.g. "v1.2.3" or "1.2.3") — strip leading v for consistency
        fromVersion = from.replace(/^v/, '');
        toVersion = toClean;
      }
    }
  }

  if (/gitlab\.com/i.test(repoUrl)) {
    return `${repoUrl}/-/compare/${fromVersion}...${toVersion}`;
  }
  if (/bitbucket\.org/i.test(repoUrl)) {
    return `${repoUrl}/branches/compare/${fromVersion}..${toVersion}`;
  }
  // GitHub and generic git hosts
  return `${repoUrl}/compare/${fromVersion}...${toVersion}`;
}

export type RawCategory = { category: string; entries: import('./types.js').ChangelogEntry[] };

export function buildOrderedCategories(
  rawCategories: RawCategory[],
  configCategories?: LLMCategory[],
): EnhancedCategory[] {
  const order = configCategories?.map((c) => c.name) ?? [];
  const mapped = rawCategories.map((c) => ({ name: c.category, entries: c.entries }));
  if (order.length === 0) return mapped;
  return mapped.sort((a, b) => {
    const ai = order.indexOf(a.name);
    const bi = order.indexOf(b.name);
    return (ai === -1 ? order.length : ai) - (bi === -1 ? order.length : bi);
  });
}

export function createTemplateContext(pkg: PackageChangelog): TemplateContext {
  const compareUrl =
    pkg.repoUrl && pkg.previousVersion
      ? generateCompareUrl(pkg.repoUrl, pkg.previousVersion, pkg.version, pkg.packageName)
      : undefined;

  return {
    packageName: pkg.packageName,
    version: pkg.version,
    previousVersion: pkg.previousVersion,
    date: pkg.date,
    repoUrl: pkg.repoUrl,
    entries: pkg.entries,
    compareUrl,
  };
}

export function createDocumentContext(contexts: TemplateContext[], repoUrl?: string): DocumentContext {
  const compareUrls: Record<string, string> = {};
  for (const ctx of contexts) {
    if (ctx.compareUrl) {
      compareUrls[ctx.version] = ctx.compareUrl;
    }
  }

  return {
    project: {
      name: contexts[0]?.packageName ?? 'project',
      repoUrl,
    },
    versions: contexts,
    compareUrls: Object.keys(compareUrls).length > 0 ? compareUrls : undefined,
  };
}

async function processWithLLM(
  context: TemplateContext,
  llmConfig: LLMConfig,
  examples: Example[],
): Promise<TemplateContext> {
  const tasks = llmConfig.tasks ?? {};
  const llmContext = {
    packageName: context.packageName,
    version: context.version,
    previousVersion: context.previousVersion ?? undefined,
    date: context.date,
    categories: llmConfig.categories,
    style: llmConfig.style,
    scopes: llmConfig.scopes,
    prompts: llmConfig.prompts,
    examples,
  };

  const enhanced: EnhancedData = {
    entries: context.entries,
  };

  try {
    info(`Using LLM provider: ${llmConfig.provider}${llmConfig.model ? ` (${llmConfig.model})` : ''}`);
    if (llmConfig.baseURL) {
      info(`LLM base URL: ${llmConfig.baseURL}`);
    }

    const rawProvider = createProvider(llmConfig);
    const retryOpts = llmConfig.retry ?? LLM_DEFAULTS.retry;
    const configOptions = llmConfig.options;
    const provider: LLMProvider = {
      name: rawProvider.name,
      capabilities: rawProvider.capabilities,
      complete: (messages, opts) =>
        withRetry(() => rawProvider.complete(messages, { ...configOptions, ...opts }), retryOpts),
    };

    const activeTasks = Object.entries(tasks)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name);
    info(`Running LLM tasks: ${activeTasks.join(', ')}`);

    if (tasks.enhance && tasks.categorize) {
      info('Enhancing and categorizing entries with LLM...');
      const result = await enhanceAndCategorize(provider, context.entries, llmContext);
      enhanced.entries = result.enhancedEntries;
      enhanced.categories = buildOrderedCategories(result.categories, llmContext.categories);
      info(`Enhanced ${enhanced.entries.length} entries into ${result.categories.length} categories`);
    } else {
      if (tasks.enhance) {
        info('Enhancing entries with LLM...');
        enhanced.entries = await enhanceEntries(provider, context.entries, llmContext, llmConfig.concurrency);
        info(`Enhanced ${enhanced.entries.length} entries`);
      }

      if (tasks.categorize) {
        info('Categorizing entries with LLM...');
        const categorized = await categorizeEntries(provider, enhanced.entries, llmContext);
        enhanced.categories = buildOrderedCategories(categorized, llmContext.categories);
        info(`Created ${categorized.length} categories`);
      }
    }

    if (tasks.summarize) {
      info('Summarizing entries with LLM...');
      enhanced.summary = await summarizeEntries(provider, enhanced.entries, llmContext);
      if (enhanced.summary) {
        info('Summary generated successfully');
        debug(`Summary: ${enhanced.summary.substring(0, 100)}...`);
      } else {
        warn('Summary generation returned empty result');
      }
    }

    if (tasks.releaseNotes) {
      info('Generating release notes with LLM...');
      enhanced.releaseNotes = await generateReleaseNotes(provider, enhanced.entries, llmContext);
      if (enhanced.releaseNotes) {
        info('Release notes generated successfully');
      } else {
        warn('Release notes generation returned empty result');
      }
    }

    return {
      ...context,
      enhanced,
    };
  } catch (error) {
    warn(`LLM processing failed: ${error instanceof Error ? error.message : String(error)}`);
    warn('Falling back to non-LLM changelog rendering. Check your LLM config or set RELEASEKIT_DEBUG=1 for details.');
    return context;
  }
}

function getBuiltinTemplatePath(style: string): string {
  let packageRoot: string;

  try {
    const currentUrl = import.meta.url;
    packageRoot = path.dirname(new URL(currentUrl).pathname);
    packageRoot = path.join(packageRoot, '..', '..');
  } catch {
    packageRoot = __dirname;
  }

  return path.join(packageRoot, 'templates', style);
}

async function generateWithTemplate(
  contexts: TemplateContext[],
  templatesConfig: { path?: string; engine?: string } | undefined,
  outputPath: string,
  repoUrl: string | undefined,
  dryRun: boolean,
): Promise<void> {
  let templatePath: string;

  if (templatesConfig?.path) {
    templatePath = path.resolve(templatesConfig.path);
  } else {
    templatePath = getBuiltinTemplatePath('keep-a-changelog');
  }

  const documentContext = createDocumentContext(contexts, templatesConfig?.path ? undefined : repoUrl);

  const result = renderTemplate(templatePath, documentContext, templatesConfig?.engine as TemplateEngine | undefined);

  if (dryRun) {
    info(`[DRY RUN] Changelog preview (would write to ${outputPath}):`);
    info(result.content);
    return;
  }

  if (outputPath === '-') {
    process.stdout.write(result.content);
    return;
  }

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outputPath, result.content, 'utf-8');
  const label = /changelog/i.test(outputPath) ? 'Changelog' : 'Release notes';
  success(`${label} written to ${outputPath} (using ${result.engine} template)`);
}

export interface PipelineResult {
  /** Per-package rendered markdown keyed by package name. */
  packageNotes: Record<string, string>;
  /** File paths that were written to disk. */
  files: string[];
  /** GitHub release notes content keyed by package name. */
  releaseNotes?: Record<string, string>;
}

export async function runPipeline(input: ChangelogInput, config: Config, dryRun: boolean): Promise<PipelineResult> {
  debug(`Processing ${input.packages.length} package(s)`);

  let contexts = input.packages.map(createTemplateContext);

  // changelog defaults to on (mode: root) when omitted; false = explicitly disabled.
  // mode defaults to 'root' for any object config that omits it (e.g. { file: 'CHANGES.md' }).
  const changelogConfig = config.changelog === false ? false : { mode: 'root' as const, ...(config.changelog ?? {}) };
  // releaseNotes: undefined = off (default), false = explicitly disabled, object = configured.
  // mode defaults to 'root' only when file output is explicitly intended (mode or file is set).
  // Omitting both lets LLM run without writing any file, as documented in the schema.
  const releaseNotesConfig =
    config.releaseNotes === false || config.releaseNotes === undefined
      ? undefined
      : config.releaseNotes.mode !== undefined || config.releaseNotes.file !== undefined
        ? { mode: 'root' as const, ...config.releaseNotes }
        : config.releaseNotes;

  const llmConfig = releaseNotesConfig?.llm;
  if (llmConfig && !process.env.CHANGELOG_NO_LLM) {
    info('Processing with LLM enhancement');

    const examplesCount = llmConfig.examples ?? 3;
    const repoUrl = contexts[0]?.repoUrl ?? input.metadata?.repoUrl;
    const ownerRepo = repoUrl ? parseOwnerRepo(repoUrl) : null;
    const examplesByPackage = new Map<string, Example[]>();

    if (examplesCount > 0 && ownerRepo) {
      await Promise.all(
        contexts.map(async (ctx) => {
          const examples = await fetchExamples({
            owner: ownerRepo.owner,
            repo: ownerRepo.repo,
            packageName: ctx.packageName,
            count: examplesCount,
            isMonorepo: contexts.length > 1,
          });
          examplesByPackage.set(ctx.packageName, examples);
          if (examples.length > 0) {
            debug(`Loaded ${examples.length} example(s) for ${ctx.packageName}`);
          }
        }),
      );
    }

    // Fetch PR context for all entries across all packages
    const prCache = new Map<number, PRContext | null>();
    const pullRequestsEnabled = llmConfig.context?.pullRequests !== false;
    if (pullRequestsEnabled && ownerRepo) {
      const allIssueNumbers = [
        ...new Set(contexts.flatMap((ctx) => ctx.entries.flatMap((e) => parseIssueNumbers(e.issueIds ?? [])))),
      ];

      if (allIssueNumbers.length > 0) {
        const token = resolveGitHubToken();
        if (!token) {
          warn('No GitHub token available — skipping PR context fetch (set GITHUB_TOKEN to enable)');
        } else {
          debug(`Fetching PR context for ${allIssueNumbers.length} issue(s)`);
          await fetchPullRequestContext(ownerRepo.owner, ownerRepo.repo, allIssueNumbers, token, prCache);
          debug(`Loaded PR context for ${prCache.size} issue(s)`);
        }
      }
    }

    // Decorate entries with fetched PR context
    if (prCache.size > 0) {
      contexts = contexts.map((ctx) => ({
        ...ctx,
        entries: ctx.entries.map((entry) => {
          const prs = parseIssueNumbers(entry.issueIds ?? [])
            .map((n) => prCache.get(n))
            .filter((pr): pr is PRContext => pr != null);
          return prs.length > 0 ? { ...entry, context: { prs } } : entry;
        }),
      }));
    }

    contexts = await Promise.all(
      contexts.map((ctx) => processWithLLM(ctx, llmConfig, examplesByPackage.get(ctx.packageName) ?? [])),
    );
  }

  const files: string[] = [];

  const fmtOpts: FormatVersionOptions = {
    includePackageName: contexts.length > 1 || contexts.some((c) => c.packageName.includes('/')),
    categoryOrder: llmConfig?.categoryOrder,
    links: releaseNotesConfig?.links,
  };

  if (changelogConfig !== false && changelogConfig.mode) {
    const fileName = changelogConfig.file ?? 'CHANGELOG.md';
    const mode = changelogConfig.mode;

    info(`Generating changelog → ${fileName}`);

    try {
      if (mode === 'root' || mode === 'both') {
        if (changelogConfig.templates?.path) {
          await generateWithTemplate(
            contexts,
            changelogConfig.templates,
            fileName,
            contexts[0]?.repoUrl ?? undefined,
            dryRun,
          );
        } else {
          writeMarkdown(fileName, contexts, config, dryRun, fmtOpts);
        }
        if (!dryRun) files.push(fileName);
      }

      if (mode === 'packages' || mode === 'both') {
        const monoFiles = await writeMonorepoFiles(contexts, config, dryRun, changelogConfig.file ?? 'CHANGELOG.md');
        files.push(...monoFiles);
      }
    } catch (error) {
      warn(`Failed to write changelog: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (releaseNotesConfig?.mode) {
    const fileName = releaseNotesConfig.file ?? 'RELEASE_NOTES.md';
    const mode = releaseNotesConfig.mode;

    info(`Generating release notes → ${fileName}`);

    try {
      if (mode === 'root' || mode === 'both') {
        if (releaseNotesConfig.templates?.path) {
          await generateWithTemplate(
            contexts,
            releaseNotesConfig.templates,
            fileName,
            contexts[0]?.repoUrl ?? undefined,
            dryRun,
          );
        } else {
          writeMarkdown(fileName, contexts, config, dryRun, fmtOpts);
        }
        if (!dryRun) files.push(fileName);
      }

      if (mode === 'packages' || mode === 'both') {
        const monoFiles = await writeMonorepoFiles(
          contexts,
          config,
          dryRun,
          releaseNotesConfig.file ?? 'RELEASE_NOTES.md',
        );
        files.push(...monoFiles);
      }
    } catch (error) {
      warn(`Failed to write release notes: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const packageNotes: Record<string, string> = {};
  const releaseNotesResult: Record<string, string> = {};
  for (const ctx of contexts) {
    packageNotes[ctx.packageName] = formatVersion(ctx);
    if (ctx.enhanced?.releaseNotes) {
      releaseNotesResult[ctx.packageName] = ctx.enhanced.releaseNotes;
    } else if (releaseNotesConfig) {
      // Populate release notes for the workflow summary even when no LLM releaseNotes task ran.
      if (releaseNotesConfig.templates?.path) {
        try {
          const templatePath = path.resolve(releaseNotesConfig.templates.path);
          const docCtx = { ...createDocumentContext([ctx], undefined), perPackage: true };
          const rendered = renderTemplate(
            templatePath,
            docCtx,
            releaseNotesConfig.templates.engine as TemplateEngine | undefined,
          );
          releaseNotesResult[ctx.packageName] = rendered.content;
        } catch (err) {
          warn(
            `Failed to render release notes template for ${ctx.packageName}: ${err instanceof Error ? err.message : String(err)}`,
          );
          warn(`Release notes preview will not be available for ${ctx.packageName} in the workflow summary`);
        }
      } else {
        info(
          `No LLM release notes or template output for ${ctx.packageName}, using formatted changelog as release notes preview`,
        );
        releaseNotesResult[ctx.packageName] = formatVersion(ctx);
      }
    }
  }

  return {
    packageNotes,
    files,
    releaseNotes: Object.keys(releaseNotesResult).length > 0 ? releaseNotesResult : undefined,
  };
}

export async function processInput(inputJson: string, config: Config, dryRun: boolean): Promise<PipelineResult> {
  const input = parseVersionOutput(inputJson);
  return runPipeline(input, config, dryRun);
}

async function writeMonorepoFiles(
  contexts: TemplateContext[],
  config: Config,
  dryRun: boolean,
  fileName: string,
): Promise<string[]> {
  const { detectMonorepo, writeMonorepoChangelogs } = await import('../monorepo/aggregator.js');
  const cwd = process.cwd();
  const detected = detectMonorepo(cwd);

  if (!detected.isMonorepo) return [];

  const monoFiles = writeMonorepoChangelogs(
    contexts,
    {
      rootPath: config.monorepo?.rootPath ?? cwd,
      packagesPath: config.monorepo?.packagesPath ?? detected.packagesPath,
      mode: 'packages',
      fileName,
    },
    config,
    dryRun,
  );

  return monoFiles;
}
