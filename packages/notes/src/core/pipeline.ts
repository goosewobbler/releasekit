import * as path from 'node:path';
import { assertLlmModel, configuredRefsMode, runsLlmTasks } from '@releasekit/config';
import {
  BREAKING_SECTION,
  debug,
  groupChangelogSections,
  info,
  parseGitHubOwnerRepo,
  renderBundledBlocks,
  renderChangelogEntryLine,
  resolveBundled,
  sharedPackageEntriesOf,
  unlistedEntries,
  warn,
} from '@releasekit/core';
import { parseVersionOutput } from '../input/version-output.js';
import { withContentHashCache } from '../llm/cache.js';
import { fetchPullRequestContext, parseIssueNumbers, resolveGitHubToken } from '../llm/context/prFetcher.js';
import { LLM_DEFAULTS } from '../llm/defaults.js';
import { fetchExamples } from '../llm/examples/fetcher.js';
import type { Example, LLMProvider } from '../llm/index.js';
import { createProvider } from '../llm/index.js';
import { isRetryableLLMError } from '../llm/retryable.js';
import { categorizeEntries } from '../llm/tasks/categorize.js';
import { enhanceEntries } from '../llm/tasks/enhance.js';
import { enhanceAndCategorize } from '../llm/tasks/enhance-and-categorize.js';
import { generateReleaseNotes } from '../llm/tasks/release-notes.js';
import { summarizeEntries } from '../llm/tasks/summarize.js';
import {
  type FormatVersionOptions,
  formatVersion,
  renderMarkdown,
  sharedPackageBlock,
  versionSections,
  writeChangelog,
} from '../output/markdown.js';
import { nestsReleaseNotes, writeVersionedNotes } from '../output/versioned.js';
import { renderTemplate } from '../templates/loader.js';
import { mapWithConcurrency } from '../utils/concurrency.js';
import { withRetry } from '../utils/retry.js';
import type {
  ChangelogEntry,
  ChangelogInput,
  Config,
  DocumentContext,
  EnhancedCategory,
  EnhancedData,
  LLMCategory,
  LLMConfig,
  PackageChangelog,
  PRContext,
  ReleaseNotesConfig,
  TemplateContext,
  TemplateEngine,
  TemplateEntry,
  TemplateSection,
  TemplateVersion,
} from './types.js';

function ownPrNumber(entry: ChangelogEntry): number | undefined {
  return entry.prNumber ? parseIssueNumbers([entry.prNumber])[0] : undefined;
}

/**
 * For dash-format compound tags (e.g. "scope-pkg-1.2.3" or "scope-pkg-1.2.3-next.1"),
 * find the index of the '-' that separates the package prefix from the semver version.
 */
function findCompoundTagSepPos(tag: string): number {
  let pos = tag.lastIndexOf('-');
  while (pos > 0) {
    const afterDash = pos + 1;
    if (tag.charCodeAt(afterDash) >= 48 && tag.charCodeAt(afterDash) <= 57) {
      let dots = 0;
      for (let i = afterDash; i < tag.length; i++) {
        if (tag[i] === '.') {
          dots++;
        }
      }
      if (dots >= 2) {
        return pos;
      }
    }
    pos = tag.lastIndexOf('-', pos - 1);
  }
  return -1;
}

function isVersionStartAt(tag: string, i: number): boolean {
  const c = tag.charCodeAt(i);
  if (c >= 48 && c <= 57) {
    return true;
  }
  if (tag[i] === 'v') {
    const n = tag.charCodeAt(i + 1);
    return n >= 48 && n <= 57;
  }
  return false;
}

function generateCompareUrl(repoUrl: string, from: string, to: string, packageName?: string, tag?: string): string {
  const isPackageSpecific = from.includes('@') && packageName && from.includes(packageName);

  let toVersion: string;

  if (tag) {
    toVersion = tag;
  } else if (isPackageSpecific) {
    // to: 0.2.0-next.10 -> @releasekit/version@v0.2.0-next.10
    toVersion = `${packageName}@${to.startsWith('v') ? '' : 'v'}${to}`;
  } else {
    // Index-based string operations instead of regex to avoid ReDoS on inputs with many repeated digits.
    const toClean = to.replace(/^v/, '');
    const atPos = from.lastIndexOf('@');
    const dashVPos = from.lastIndexOf('-v');
    if (atPos > 0 && isVersionStartAt(from, atPos + 1)) {
      // Sanitized package-specific tag: "<de-scoped-name>@[v]<version>" (e.g. "scope-pkg@v1.2.3").
      // formatTag always strips the "@scope/", so the raw package name never appears literally and
      // the isPackageSpecific check above can't match it.
      toVersion = `${from.slice(0, atPos + 1)}${from[atPos + 1] === 'v' ? 'v' : ''}${toClean}`;
    } else if (dashVPos > 0 && from.charCodeAt(dashVPos + 2) >= 48 && from.charCodeAt(dashVPos + 2) <= 57) {
      // Compound tag with "v" prefix (e.g. "scope-pkg-v1.2.3")
      toVersion = `${from.slice(0, dashVPos + 1)}v${toClean}`;
    } else {
      const sepPos = findCompoundTagSepPos(from);
      if (sepPos > 0) {
        toVersion = `${from.slice(0, sepPos + 1)}${toClean}`;
      } else {
        // Plain version tag (e.g. "v1.2.3" or "1.2.3")
        toVersion = `${from.startsWith('v') ? 'v' : ''}${toClean}`;
      }
    }
  }

  if (/gitlab\.com/i.test(repoUrl)) {
    return `${repoUrl}/-/compare/${from}...${toVersion}`;
  }
  if (/bitbucket\.org/i.test(repoUrl)) {
    return `${repoUrl}/branches/compare/${from}..${toVersion}`;
  }
  // GitHub and generic git hosts
  return `${repoUrl}/compare/${from}...${toVersion}`;
}

export type RawCategory = { category: string; entries: import('./types.js').ChangelogEntry[] };

export function buildOrderedCategories(
  rawCategories: RawCategory[],
  configCategories?: LLMCategory[],
): EnhancedCategory[] {
  const order = configCategories?.map((c) => c.name) ?? [];
  const mapped = rawCategories.map((c) => ({ name: c.category, entries: c.entries }));
  if (order.length === 0) {
    return mapped;
  }
  return mapped.sort((a, b) => {
    const ai = order.indexOf(a.name);
    const bi = order.indexOf(b.name);
    return (ai === -1 ? order.length : ai) - (bi === -1 ? order.length : bi);
  });
}

export function createTemplateContext(pkg: PackageChangelog): TemplateContext {
  const compareUrl =
    pkg.repoUrl && pkg.previousVersion
      ? generateCompareUrl(pkg.repoUrl, pkg.previousVersion, pkg.version, pkg.packageName, pkg.tag)
      : undefined;

  return {
    packageName: pkg.packageName,
    version: pkg.version,
    previousVersion: pkg.previousVersion,
    date: pkg.date,
    repoUrl: pkg.repoUrl,
    entries: pkg.entries,
    compareUrl,
    isFirstRelease: pkg.previousVersion === null,
  };
}

function toTemplateVersion(ctx: TemplateContext, options: FormatVersionOptions): TemplateVersion {
  const refs = options.refs ?? 'link';
  const withLine = (entry: ChangelogEntry): TemplateEntry => ({
    ...entry,
    line: renderChangelogEntryLine(entry, refs, ctx.repoUrl),
  });

  const toTemplateSection = (s: { label: string; items: ChangelogEntry[] }): TemplateSection => ({
    label: s.label,
    entries: s.items.map(withLine),
  });

  const { enhanced, sharedEntries, bundled, ...rest } = ctx;
  const { categories: _, ...prose } = enhanced ?? {};
  return {
    ...rest,
    entries: ctx.entries.map(withLine),
    sections: versionSections(ctx, options.categoryOrder).map(toTemplateSection),
    shared: groupChangelogSections(sharedEntries ?? [], (e) => e).map(toTemplateSection),
    bundled: (bundled ?? []).map(({ entries, ...pkg }) => ({
      ...pkg,
      sections: groupChangelogSections(entries, (e) => e).map(toTemplateSection),
    })),
    // Set even when absent: EJS throws on a bare `enhanced` that isn't a key.
    enhanced: prose.summary || prose.releaseNotes ? prose : undefined,
  };
}

export function createDocumentContext(
  contexts: TemplateContext[],
  repoUrl: string | undefined,
  options: FormatVersionOptions,
  sharedEntries: ChangelogEntry[] = [],
): DocumentContext {
  const refs = options.refs ?? 'link';
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
    versions: contexts.map((ctx) => toTemplateVersion(ctx, options)),
    compareUrls: Object.keys(compareUrls).length > 0 ? compareUrls : undefined,
    shared: groupChangelogSections(sharedEntries, (e) => e).map((s) => ({
      label: s.label,
      entries: s.items.map((entry) => ({
        ...entry,
        line: renderChangelogEntryLine(entry, refs, repoUrl ?? null),
      })),
    })),
  };
}

async function processWithLLM(
  context: TemplateContext,
  llmConfig: LLMConfig & { model: string },
  examples: Example[],
  packageNames: string[],
): Promise<TemplateContext> {
  const tasks = llmConfig.tasks ?? {};
  const llmContext = {
    packageName: context.packageName,
    version: context.version,
    previousVersion: context.previousVersion ?? undefined,
    date: context.date,
    // The commit's breaking flag, not the model, puts an entry under Breaking.
    categories: llmConfig.categories?.filter((c) => c.name !== BREAKING_SECTION),
    style: llmConfig.style,
    scopes: llmConfig.scopes,
    prompts: llmConfig.prompts,
    examples,
    packageNames,
  };

  let entries = context.entries;
  const enhanced: EnhancedData = {};

  let provider: LLMProvider;
  try {
    info(`Using LLM provider: ${llmConfig.provider}${llmConfig.model ? ` (${llmConfig.model})` : ''}`);
    if (llmConfig.baseURL) {
      info(`LLM base URL: ${llmConfig.baseURL}`);
    }

    const rawProvider = createProvider(llmConfig);
    // Innermost, so a cache hit skips both the provider call and the retry wrapper.
    const baseProvider = llmConfig.cache
      ? withContentHashCache(rawProvider, { model: llmConfig.model, baseURL: llmConfig.baseURL })
      : rawProvider;
    const retryOpts = llmConfig.retry ?? LLM_DEFAULTS.retry;
    const configOptions = llmConfig.options;
    provider = {
      name: baseProvider.name,
      capabilities: baseProvider.capabilities,
      complete: (messages, opts) =>
        withRetry(() => baseProvider.complete(messages, { ...configOptions, ...opts }), {
          ...retryOpts,
          shouldRetry: isRetryableLLMError,
        }),
    };

    const activeTasks = Object.entries(tasks)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name);
    info(`Running LLM tasks: ${activeTasks.join(', ')}`);
  } catch (error) {
    warn(`LLM setup failed: ${error instanceof Error ? error.message : String(error)}`);
    warn('Falling back to non-LLM release notes. Check your LLM config or set RELEASEKIT_DEBUG=1 for details.');
    return context;
  }

  // Each task soft-fails independently: a late summarize/releaseNotes failure must not discard the
  // (already paid-for) enhancement and categorization computed earlier in the same run.
  const taskFailed = (task: string, error: unknown): void => {
    warn(`LLM ${task} failed: ${error instanceof Error ? error.message : String(error)}. Keeping results so far.`);
  };

  if (tasks.enhance && tasks.categorize) {
    try {
      info('Enhancing and categorizing entries with LLM...');
      const result = await enhanceAndCategorize(provider, entries, llmContext);
      entries = result.enhancedEntries;
      enhanced.categories = buildOrderedCategories(result.categories, llmContext.categories);
      info(`Enhanced ${entries.length} entries into ${result.categories.length} categories`);
    } catch (error) {
      taskFailed('enhance+categorize', error);
    }
  } else {
    if (tasks.enhance) {
      try {
        info('Enhancing entries with LLM...');
        entries = await enhanceEntries(provider, entries, llmContext, llmConfig.concurrency);
        info(`Enhanced ${entries.length} entries`);
      } catch (error) {
        taskFailed('enhance', error);
      }
    }

    if (tasks.categorize) {
      try {
        info('Categorizing entries with LLM...');
        const categorized = await categorizeEntries(provider, entries, llmContext);
        enhanced.categories = buildOrderedCategories(categorized, llmContext.categories);
        info(`Created ${categorized.length} categories`);
      } catch (error) {
        taskFailed('categorize', error);
      }
    }
  }

  if (tasks.summarize) {
    try {
      info('Summarizing entries with LLM...');
      enhanced.summary = await summarizeEntries(provider, entries, llmContext);
      if (enhanced.summary) {
        info('Summary generated successfully');
        debug(`Summary: ${enhanced.summary.substring(0, 100)}...`);
      } else {
        warn('Summary generation returned empty result');
      }
    } catch (error) {
      taskFailed('summarize', error);
    }
  }

  if (tasks.releaseNotes) {
    try {
      info('Generating release notes with LLM...');
      enhanced.releaseNotes = await generateReleaseNotes(provider, entries, llmContext);
      if (enhanced.releaseNotes) {
        info('Release notes generated successfully');
      } else {
        warn('Release notes generation returned empty result');
      }
    } catch (error) {
      taskFailed('releaseNotes', error);
    }
  }

  return {
    ...context,
    entries,
    enhanced,
  };
}

// Never the changelog document - release notes aren't a changelog.
function renderReleaseNotes(
  ctx: TemplateContext,
  output: 'file' | 'release',
  releaseNotesConfig: ReleaseNotesConfig,
  fmtOpts: FormatVersionOptions,
): string {
  if (releaseNotesConfig.templates?.path) {
    const templatePath = path.resolve(releaseNotesConfig.templates.path);
    const docCtx = {
      ...createDocumentContext([ctx], ctx.repoUrl ?? undefined, fmtOpts),
      perPackage: true,
      output,
    };
    return renderTemplate(templatePath, docCtx, releaseNotesConfig.templates.engine as TemplateEngine | undefined)
      .content;
  }
  const refs = fmtOpts.refs ?? 'link';
  const prose = ctx.enhanced?.releaseNotes;
  const own = prose ? [prose.trimEnd(), sharedPackageBlock(ctx, refs)] : [formatVersion(ctx, fmtOpts).trimEnd()];
  const blocks = [...own, ...renderBundledBlocks(ctx.bundled ?? [], 3, refs, ctx.repoUrl)].filter(
    (block): block is string => !!block,
  );
  return prose && blocks.length === 1 ? prose : `${blocks.join('\n\n')}\n`;
}

export interface PipelineResult {
  /** Per-package rendered markdown keyed by package name. */
  packageNotes: Record<string, string>;
  /** File paths that were written to disk. */
  files: string[];
  /** GitHub release notes content keyed by package name. */
  releaseNotes?: Record<string, string>;
}

export interface PipelineOptions {
  /**
   * Skip the LLM pass and the release-notes file write. Use during standing-PR update so the
   * standing-PR workflow doesn't depend on LLM availability and doesn't pay for
   * an LLM call on every push to main.
   */
  skipReleaseNotes?: boolean;
  /** Use during publish from manifest to regenerate only the release notes against an already-bumped tree. */
  skipChangelogs?: boolean;
  /**
   * Generate release notes only for these packages, and no changelogs. The other packages still count toward the
   * release-notes file layout.
   */
  releaseNotesFor?: string[];
}

export async function runPipeline(
  input: ChangelogInput,
  config: Config,
  dryRun: boolean,
  pipelineOptions?: PipelineOptions,
): Promise<PipelineResult> {
  debug(`Processing ${input.packages.length} package(s)`);

  // The changelog renders from these; LLM output goes only to release surfaces.
  const changelogContexts = input.packages.map(createTemplateContext);
  const releaseNotesFor = pipelineOptions?.releaseNotesFor;
  let releaseNotesContexts = releaseNotesFor
    ? changelogContexts.filter((ctx) => releaseNotesFor.includes(ctx.packageName))
    : changelogContexts;

  const changelogConfig = config.changelog === false ? false : { mode: 'root' as const, ...(config.changelog ?? {}) };
  const releaseNotesConfig =
    config.releaseNotes === false || config.releaseNotes === undefined ? undefined : config.releaseNotes;

  const llmConfig = releaseNotesConfig?.llm;
  if (llmConfig && runsLlmTasks(llmConfig, pipelineOptions?.skipReleaseNotes)) {
    assertLlmModel(llmConfig);
    info('Processing with LLM enhancement');

    const examplesCount = llmConfig.examples ?? 3;
    const repoUrl = releaseNotesContexts[0]?.repoUrl ?? input.metadata?.repoUrl;
    const ownerRepo = repoUrl ? parseGitHubOwnerRepo(repoUrl) : null;
    const examplesByPackage = new Map<string, Example[]>();

    if (examplesCount > 0 && ownerRepo) {
      await Promise.all(
        releaseNotesContexts.map(async (ctx) => {
          const examples = await fetchExamples({
            owner: ownerRepo.owner,
            repo: ownerRepo.repo,
            packageName: ctx.packageName,
            count: examplesCount,
            isMonorepo: input.packages.length > 1,
          });
          examplesByPackage.set(ctx.packageName, examples);
          if (examples.length > 0) {
            debug(`Loaded ${examples.length} example(s) for ${ctx.packageName}`);
          }
        }),
      );
    }

    const prCache = new Map<number, PRContext | null>();
    const pullRequestsEnabled = llmConfig.context?.pullRequests !== false;
    if (pullRequestsEnabled && ownerRepo) {
      // Only the entry's own PR: a PR its body names describes a different change.
      const allPrNumbers = [
        ...new Set(releaseNotesContexts.flatMap((ctx) => ctx.entries.flatMap((e) => ownPrNumber(e) ?? []))),
      ];

      if (allPrNumbers.length > 0) {
        const token = resolveGitHubToken();
        if (!token) {
          warn('No GitHub token available — skipping PR context fetch (set GITHUB_TOKEN to enable)');
        } else {
          debug(`Fetching PR context for ${allPrNumbers.length} PR(s)`);
          await fetchPullRequestContext(ownerRepo.owner, ownerRepo.repo, allPrNumbers, token, prCache);
          debug(`Loaded PR context for ${prCache.size} PR(s)`);
        }
      }
    }

    if (prCache.size > 0) {
      releaseNotesContexts = releaseNotesContexts.map((ctx) => ({
        ...ctx,
        entries: ctx.entries.map((entry) => {
          const number = ownPrNumber(entry);
          const pr = number === undefined ? undefined : prCache.get(number);
          return pr ? { ...entry, context: { prs: [pr] } } : entry;
        }),
      }));
    }

    const allPackageNames = input.packages.map((p) => p.packageName);
    // Bound cross-package fan-out with the same `concurrency` knob used within a package, so a large
    // monorepo doesn't open one in-flight LLM request per package all at once and trip rate limits.
    const concurrency = llmConfig.concurrency ?? LLM_DEFAULTS.concurrency;
    releaseNotesContexts = await mapWithConcurrency(releaseNotesContexts, concurrency, (ctx) =>
      processWithLLM(ctx, llmConfig, examplesByPackage.get(ctx.packageName) ?? [], allPackageNames),
    );
  }

  const sharedEntries = input.sharedEntries ?? [];
  const packages = new Map(input.packages.map((pkg) => [pkg.packageName, pkg]));
  const withShared = (ctx: TemplateContext): TemplateContext => {
    const pkg = packages.get(ctx.packageName);
    const shared = pkg ? sharedPackageEntriesOf(pkg, sharedEntries) : [];
    return shared.length > 0 ? { ...ctx, sharedEntries: shared } : ctx;
  };
  const releases = [...(input.bundledReleases ?? []), ...input.packages];
  const withBundled = (ctx: TemplateContext): TemplateContext => {
    const bundled = resolveBundled(packages.get(ctx.packageName)?.bundled, releases);
    if (bundled.length === 0) {
      return ctx;
    }
    // A primary bumped only for its bundled packages: they are its notes, not its placeholder.
    const entries = ctx.entries.filter((e) => e.description !== `Update version to ${ctx.version}`);
    return { ...ctx, entries, bundled };
  };
  releaseNotesContexts = releaseNotesContexts.map(withShared).map(withBundled);

  const files: string[] = [];

  const fmtOpts: FormatVersionOptions = {
    includePackageName: input.packages.length > 1 || changelogContexts.some((c) => c.packageName.includes('/')),
    categoryOrder: llmConfig?.categoryOrder,
    links: releaseNotesConfig?.links,
    firstRelease: releaseNotesConfig?.firstRelease,
    refs: configuredRefsMode(config),
  };

  if (!pipelineOptions?.skipChangelogs && !releaseNotesFor && changelogConfig !== false && changelogConfig.mode) {
    const fileName = changelogConfig.file ?? 'CHANGELOG.md';
    const mode = changelogConfig.mode;
    const templates = changelogConfig.templates;

    const renderChangelog = (
      ctxs: TemplateContext[],
      options: FormatVersionOptions,
      runSharedEntries?: ChangelogEntry[],
    ): string =>
      templates?.path
        ? renderTemplate(
            path.resolve(templates.path),
            createDocumentContext(ctxs, ctxs[0]?.repoUrl ?? undefined, options, runSharedEntries),
            templates.engine,
          ).content
        : renderMarkdown(ctxs, options, runSharedEntries);

    info(`Generating changelog → ${fileName}`);

    try {
      if (mode === 'root' || mode === 'both') {
        const runEntries = changelogContexts.flatMap((ctx) => ctx.entries);
        writeChangelog(
          fileName,
          renderChangelog(changelogContexts, fmtOpts, unlistedEntries(sharedEntries, runEntries)),
          dryRun,
        );
        if (!dryRun) {
          files.push(fileName);
        }
      }

      if (mode === 'packages' || mode === 'both') {
        const refs = fmtOpts.refs;
        const monoFiles = await writeMonorepoFiles(
          changelogContexts.map(withShared),
          config,
          dryRun,
          fileName,
          (ctxs) => renderChangelog(ctxs, { refs }),
        );
        files.push(...monoFiles);
      }
    } catch (error) {
      warn(`Failed to write changelog: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!pipelineOptions?.skipReleaseNotes && releaseNotesConfig?.file?.dir) {
    const dir = releaseNotesConfig.file.dir;
    info(`Generating release notes → ${dir}`);

    try {
      const nested = nestsReleaseNotes(input.packages.length);

      const versionedFiles = writeVersionedNotes(releaseNotesContexts, dir, dryRun, nested, (ctx) =>
        renderReleaseNotes(ctx, 'file', releaseNotesConfig, fmtOpts),
      );
      files.push(...versionedFiles);
    } catch (error) {
      warn(`Failed to write release notes: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Keyed by package, so it keeps the bare header (no includePackageName).
  const packageNotes = Object.fromEntries(
    changelogContexts.map((ctx) => [
      ctx.packageName,
      formatVersion(withShared(ctx), { firstRelease: releaseNotesConfig?.firstRelease }),
    ]),
  );
  const releaseNotesResult: Record<string, string> = {};
  for (const ctx of releaseNotesContexts) {
    // Under skipReleaseNotes, leave the map empty, or the callsite treats it as available content and propagates it.
    if (pipelineOptions?.skipReleaseNotes || !releaseNotesConfig) {
      continue;
    }
    try {
      releaseNotesResult[ctx.packageName] = renderReleaseNotes(ctx, 'release', releaseNotesConfig, fmtOpts);
    } catch (err) {
      warn(
        `Failed to render release notes for ${ctx.packageName}: ${err instanceof Error ? err.message : String(err)}`,
      );
      warn(`${ctx.packageName}'s GitHub release body uses the githubRelease.body fallback instead`);
    }
  }

  return {
    packageNotes,
    files,
    releaseNotes: Object.keys(releaseNotesResult).length > 0 ? releaseNotesResult : undefined,
  };
}

export async function processInput(
  inputJson: string,
  config: Config,
  dryRun: boolean,
  pipelineOptions?: PipelineOptions,
): Promise<PipelineResult> {
  const input = parseVersionOutput(inputJson);
  return runPipeline(input, config, dryRun, pipelineOptions);
}

async function writeMonorepoFiles(
  contexts: TemplateContext[],
  config: Config,
  dryRun: boolean,
  fileName: string,
  render: (contexts: TemplateContext[]) => string,
): Promise<string[]> {
  const { detectMonorepo, writeMonorepoChangelogs } = await import('../monorepo/aggregator.js');
  const cwd = process.cwd();
  const detected = detectMonorepo(cwd);

  if (!detected.isMonorepo) {
    return [];
  }

  return writeMonorepoChangelogs(
    contexts,
    {
      rootPath: config.monorepo?.rootPath ?? cwd,
      packagesPath: config.monorepo?.packagesPath ?? detected.packagesPath,
      fileName,
    },
    render,
    dryRun,
  );
}
