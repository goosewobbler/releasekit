import * as fs from 'node:fs';
import * as path from 'node:path';
import { debug, info, success, warn } from '@releasekit/core';
import { parsePackageVersioner } from '../input/package-versioner.js';
import { LLM_DEFAULTS } from '../llm/defaults.js';
import type { LLMProvider } from '../llm/index.js';
import {
  categorizeEntries,
  createProvider,
  enhanceAndCategorize,
  enhanceEntries,
  generateReleaseNotes,
  summarizeEntries,
} from '../llm/index.js';
import { createGitHubRelease, parseRepoUrl } from '../output/github-release.js';
import { writeJson } from '../output/json.js';
import { writeMarkdown } from '../output/markdown.js';
import { renderTemplate } from '../templates/index.js';
import { withRetry } from '../utils/retry.js';
import type {
  ChangelogInput,
  Config,
  DocumentContext,
  EnhancedData,
  PackageChangelog,
  TemplateContext,
} from './types.js';

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
    // Plain version tags - remove leading 'v' if present for consistency
    fromVersion = from.replace(/^v/, '');
    toVersion = to.replace(/^v/, '');
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

async function processWithLLM(context: TemplateContext, config: Config): Promise<TemplateContext> {
  if (!config.llm) {
    return context;
  }

  const tasks = config.llm.tasks ?? {};
  const llmContext = {
    packageName: context.packageName,
    version: context.version,
    previousVersion: context.previousVersion ?? undefined,
    date: context.date,
    categories: config.llm.categories,
    style: config.llm.style,
    scopes: config.llm.scopes,
    prompts: config.llm.prompts,
  };

  const enhanced: EnhancedData = {
    entries: context.entries,
  };

  try {
    info(`Using LLM provider: ${config.llm.provider}${config.llm.model ? ` (${config.llm.model})` : ''}`);
    if (config.llm.baseURL) {
      info(`LLM base URL: ${config.llm.baseURL}`);
    }

    const rawProvider = createProvider(config.llm);
    const retryOpts = config.llm.retry ?? LLM_DEFAULTS.retry;
    const provider: LLMProvider = {
      name: rawProvider.name,
      complete: (prompt, opts) => withRetry(() => rawProvider.complete(prompt, opts), retryOpts),
    };

    const activeTasks = Object.entries(tasks)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name);
    info(`Running LLM tasks: ${activeTasks.join(', ')}`);

    if (tasks.enhance && tasks.categorize) {
      // Combined single-call: enhance + categorize in one LLM request
      info('Enhancing and categorizing entries with LLM...');
      const result = await enhanceAndCategorize(provider, context.entries, llmContext);
      enhanced.entries = result.enhancedEntries;
      enhanced.categories = {};
      for (const cat of result.categories) {
        enhanced.categories[cat.category] = cat.entries;
      }
      info(`Enhanced ${enhanced.entries.length} entries into ${result.categories.length} categories`);
    } else {
      if (tasks.enhance) {
        info('Enhancing entries with LLM...');
        enhanced.entries = await enhanceEntries(provider, context.entries, llmContext, config.llm.concurrency);
        info(`Enhanced ${enhanced.entries.length} entries`);
      }

      if (tasks.categorize) {
        info('Categorizing entries with LLM...');
        const categorized = await categorizeEntries(provider, enhanced.entries, llmContext);
        enhanced.categories = {};
        for (const cat of categorized) {
          enhanced.categories[cat.category] = cat.entries;
        }
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
    warn('Falling back to raw entries');
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
  config: Config,
  outputPath: string,
  dryRun: boolean,
): Promise<void> {
  let templatePath: string;

  if (config.templates?.path) {
    templatePath = path.resolve(config.templates.path);
  } else {
    templatePath = getBuiltinTemplatePath('keep-a-changelog');
  }

  const documentContext = createDocumentContext(
    contexts,
    config.templates?.path ? undefined : (contexts[0]?.repoUrl ?? undefined),
  );

  const result = renderTemplate(templatePath, documentContext, config.templates?.engine);

  if (dryRun) {
    info('--- Changelog Preview ---');
    console.log(result.content);
    info('--- End Preview ---');
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
  success(`Changelog written to ${outputPath} (using ${result.engine} template)`);
}

export async function runPipeline(input: ChangelogInput, config: Config, dryRun: boolean): Promise<void> {
  debug(`Processing ${input.packages.length} package(s)`);

  let contexts = input.packages.map(createTemplateContext);

  if (config.llm && !process.env.CHANGELOG_NO_LLM) {
    info('Processing with LLM enhancement');
    contexts = await Promise.all(contexts.map((ctx) => processWithLLM(ctx, config)));
  }

  for (const output of config.output) {
    info(`Generating ${output.format} output`);

    switch (output.format) {
      case 'markdown': {
        const file = output.file ?? 'CHANGELOG.md';
        const effectiveTemplateConfig = output.templates ?? config.templates;

        if (effectiveTemplateConfig?.path || output.options?.template) {
          const configWithTemplate = { ...config, templates: effectiveTemplateConfig };
          await generateWithTemplate(contexts, configWithTemplate, file, dryRun);
        } else {
          writeMarkdown(file, contexts, config, dryRun);
        }
        break;
      }
      case 'json': {
        const file = output.file ?? 'changelog.json';
        writeJson(file, contexts, dryRun);
        break;
      }
      case 'github-release': {
        if (dryRun) {
          info('[DRY RUN] Would create GitHub release');
          break;
        }

        const firstContext = contexts[0];
        if (!firstContext) {
          warn('No context available for GitHub release');
          break;
        }

        const repoUrl = firstContext.repoUrl;
        if (!repoUrl) {
          warn('No repo URL available, cannot create GitHub release');
          break;
        }

        const parsed = parseRepoUrl(repoUrl);
        if (!parsed) {
          warn(`Could not parse repo URL: ${repoUrl}`);
          break;
        }

        await createGitHubRelease(firstContext, {
          owner: parsed.owner,
          repo: parsed.repo,
          draft: output.options?.draft as boolean | undefined,
          prerelease: output.options?.prerelease as boolean | undefined,
        });
        break;
      }
    }
  }
}

export async function processInput(inputJson: string, config: Config, dryRun: boolean): Promise<void> {
  const input = parsePackageVersioner(inputJson);
  await runPipeline(input, config, dryRun);
}
