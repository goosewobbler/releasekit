import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  BREAKING_SECTION,
  type ChangelogRefsMode,
  escapeChangelogMentions,
  escapeCommentOpeners,
  groupChangelogSections,
  info,
  neutralizeDescriptionRefs,
  renderIssueRefs,
  success,
} from '@releasekit/core';
import type {
  ChangelogEntry,
  Config,
  EnhancedCategory,
  FirstReleaseConfig,
  LinksConfig,
  TemplateContext,
} from '../core/types.js';

// A true statement, so it reads fine even when published unedited (automated modes).
// biome-ignore lint/suspicious/noTemplateCurlyInString: intentional template-placeholder syntax
const DEFAULT_FIRST_RELEASE_TEXT = '_First release of ${packageName}._';

export function firstReleaseLine(context: TemplateContext, config?: FirstReleaseConfig | false): string | undefined {
  if (!context.isFirstRelease || config === false) {
    return undefined;
  }
  const template = config?.text ?? DEFAULT_FIRST_RELEASE_TEXT;
  // biome-ignore lint/suspicious/noTemplateCurlyInString: replacing literal template placeholders
  return template.replaceAll('${packageName}', context.packageName).replaceAll('${version}', context.version);
}

const SECTION_ORDER = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security'];

interface EntryRefOptions {
  hideScope?: boolean;
  refs?: ChangelogRefsMode;
  repoUrl?: string | null;
}

// A `<!--` in a commit subject would hide the rest of the notes.
function escapeCommitText(text: string): string {
  return escapeCommentOpeners(escapeChangelogMentions(text));
}

function formatEntry(entry: ChangelogEntry, opts?: EntryRefOptions): string {
  // GitHub treats a bare `@scope/pkg` / `@user` in prose as a mention that can ping a real org/team on a
  // release PR - always neutralise it, regardless of the refs mode. The scope and lead-in are interpolated
  // as bold prose too, so escape all three. Bare `#N` refs carried over from the commit subject are also
  // de-duped against the appended label.
  const refsMode = opts?.refs ?? 'link';
  const appendedRefs = [...(entry.issueIds ?? []), entry.prNumber];
  const description = escapeCommitText(
    neutralizeDescriptionRefs(entry.description, appendedRefs, refsMode, opts?.repoUrl ?? null),
  );
  const scope = entry.scope ? escapeCommitText(entry.scope) : undefined;
  const leadIn = entry.leadIn ? escapeCommitText(entry.leadIn) : undefined;
  let line: string;

  if (leadIn && entry.breaking) {
    line = `- **BREAKING** **${leadIn}**: ${description}`;
  } else if (leadIn) {
    line = `- **${leadIn}**: ${description}`;
  } else if (entry.breaking && scope && !opts?.hideScope) {
    line = `- **BREAKING** **${scope}**: ${description}`;
  } else if (entry.breaking) {
    line = `- **BREAKING** ${description}`;
  } else if (scope && !opts?.hideScope) {
    line = `- **${scope}**: ${description}`;
  } else {
    line = `- ${description}`;
  }

  // renderIssueRefs includes its own parens.
  const refs = renderIssueRefs(entry.issueIds ?? [], refsMode, opts?.repoUrl ?? null, entry.prNumber);
  if (refs) {
    line += ` ${refs}`;
  }

  return line;
}

function formatCategorySection(name: string, entries: ChangelogEntry[], refOpts: EntryRefOptions): string[] {
  const blocks = [`### ${name}`];

  const scopeCounts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.scope) {
      scopeCounts.set(entry.scope, (scopeCounts.get(entry.scope) ?? 0) + 1);
    }
  }
  const groupedScopes = new Set<string>();
  for (const [scope, count] of scopeCounts) {
    if (count > 1) {
      groupedScopes.add(scope);
    }
  }

  // Ungrouped entries go first: after a group's list, Markdown would read them as part of that group.
  const ungrouped: ChangelogEntry[] = [];
  const byScope = new Map<string, ChangelogEntry[]>();
  for (const entry of entries) {
    if (entry.scope && groupedScopes.has(entry.scope)) {
      const group = byScope.get(entry.scope) ?? [];
      group.push(entry);
      byScope.set(entry.scope, group);
    } else {
      ungrouped.push(entry);
    }
  }

  if (ungrouped.length > 0) {
    blocks.push(ungrouped.map((entry) => formatEntry(entry, refOpts)).join('\n'));
  }
  for (const [scope, group] of byScope) {
    blocks.push(
      `**${escapeCommitText(scope)}**:`,
      group.map((entry) => formatEntry(entry, { ...refOpts, hideScope: true })).join('\n'),
    );
  }

  return blocks;
}

function rerouteBreakingEntries(categories: EnhancedCategory[]): EnhancedCategory[] {
  const hasBreaking = categories.some((c) => c.entries.some((e) => e.breaking));
  if (!hasBreaking) {
    return categories;
  }

  const breakingEntries: ChangelogEntry[] = [];
  const stripped = categories.map((c) => ({
    ...c,
    entries: c.entries.filter((e) => {
      if (e.breaking) {
        breakingEntries.push(e);
        return false;
      }
      return true;
    }),
  }));

  const breakingCatIdx = stripped.findIndex((c) => c.name === BREAKING_SECTION);
  if (breakingCatIdx >= 0) {
    return stripped.map((c, i) => (i === breakingCatIdx ? { ...c, entries: [...breakingEntries, ...c.entries] } : c));
  }
  return [{ name: BREAKING_SECTION, entries: breakingEntries }, ...stripped.filter((c) => c.entries.length > 0)];
}

function applyOrder(categories: EnhancedCategory[], order: string[]): EnhancedCategory[] {
  if (order.length === 0) {
    return categories;
  }
  return [...categories].sort((a, b) => {
    const ai = order.indexOf(a.name);
    const bi = order.indexOf(b.name);
    const rank = (name: string, idx: number) => (idx === -1 ? (name === BREAKING_SECTION ? -1 : order.length) : idx);
    return rank(a.name, ai) - rank(b.name, bi);
  });
}

interface LinkItem {
  label: string;
  url: string;
}

function parseMdLink(text: string): { label: string; url: string } | null {
  let search = 0;
  while (search < text.length) {
    const bracketOpen = text.indexOf('[', search);
    if (bracketOpen === -1) {
      return null;
    }
    const bracketClose = text.indexOf(']', bracketOpen + 1);
    if (bracketClose === -1) {
      return null;
    }
    if (text[bracketClose + 1] !== '(') {
      search = bracketClose + 1;
      continue;
    }
    const parenClose = text.indexOf(')', bracketClose + 2);
    if (parenClose === -1) {
      return null;
    }
    const label = text.slice(bracketOpen + 1, bracketClose);
    const url = text.slice(bracketClose + 2, parenClose);
    if (/^https?:\/\//.test(url)) {
      return { label, url };
    }
    search = parenClose + 1;
  }
  return null;
}

function extractLinksFromPRBodies(entries: ChangelogEntry[], marker: string): LinkItem[] {
  const seen = new Set<string>();
  const links: LinkItem[] = [];
  for (const entry of entries) {
    for (const pr of entry.context?.prs ?? []) {
      for (const line of pr.body.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith(marker)) {
          continue;
        }
        const rest = trimmed.slice(marker.length).trim();
        const mdLink = parseMdLink(rest);
        if (mdLink) {
          if (!seen.has(mdLink.url)) {
            seen.add(mdLink.url);
            links.push(mdLink);
          }
        } else {
          const url = /^https?:\/\/\S*/.exec(rest)?.[0];
          if (url && !seen.has(url)) {
            seen.add(url);
            links.push({ label: marker.replace(/:$/, ''), url });
          }
        }
      }
    }
  }
  return links;
}

function resolveLinks(entries: ChangelogEntry[], linksConfig: LinksConfig | undefined): LinkItem[] {
  if (!linksConfig) {
    return [];
  }
  const items = linksConfig.items ?? [];
  const discovered = linksConfig.fromPRBodyMarker
    ? extractLinksFromPRBodies(entries, linksConfig.fromPRBodyMarker)
    : [];
  const seen = new Set(items.map((i) => i.url));
  const merged = [...items];
  for (const link of discovered) {
    if (!seen.has(link.url)) {
      seen.add(link.url);
      merged.push(link);
    }
  }
  return merged;
}

export interface FormatVersionOptions {
  includePackageName?: boolean;
  /** Order to render LLM-categorised sections. */
  categoryOrder?: string[];
  links?: LinksConfig;
  firstRelease?: FirstReleaseConfig | false;
  refs?: ChangelogRefsMode;
}

export function formatVersion(context: TemplateContext, options?: FormatVersionOptions): string {
  const refOpts: EntryRefOptions = { refs: options?.refs ?? 'link', repoUrl: context.repoUrl };

  const versionLabel =
    options?.includePackageName && context.packageName ? `${context.packageName}@${context.version}` : context.version;
  const versionHeader = context.previousVersion ? `## [${versionLabel}]` : `## ${versionLabel}`;

  const blocks = [`${versionHeader} - ${context.date}`];

  const introLine = firstReleaseLine(context, options?.firstRelease);
  if (introLine) {
    blocks.push(introLine);
  }

  if (context.compareUrl) {
    blocks.push(`[Full Changelog](${context.compareUrl})`);
  }

  if (context.enhanced?.summary) {
    blocks.push(context.enhanced.summary);
  }

  if (context.enhanced?.categories && context.enhanced.categories.length > 0) {
    let categories = rerouteBreakingEntries(context.enhanced.categories);
    categories = applyOrder(categories, options?.categoryOrder ?? []);

    for (const category of categories) {
      if (category.entries.length === 0) {
        continue;
      }
      blocks.push(...formatCategorySection(category.name, category.entries, refOpts));
    }

    const links = resolveLinks(context.entries, options?.links);
    if (links.length > 0) {
      blocks.push(
        `### ${options?.links?.title ?? 'Links'}`,
        links.map((link) => `- [${link.label}](${link.url})`).join('\n'),
      );
    }
  } else {
    for (const section of groupChangelogSections(context.entries, (e) => e, { labelOrder: SECTION_ORDER })) {
      blocks.push(`### ${section.label}`, section.items.map((entry) => formatEntry(entry, refOpts)).join('\n'));
    }
  }

  return `${blocks.join('\n\n')}\n`;
}

function formatHeader(): string {
  return `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
`;
}

export function renderMarkdown(contexts: TemplateContext[], options?: FormatVersionOptions): string {
  const sections: string[] = [formatHeader()];

  for (const context of contexts) {
    sections.push(formatVersion(context, options));
  }

  return sections.join('\n');
}

export function prependVersions(
  existingPath: string,
  contexts: TemplateContext[],
  options?: FormatVersionOptions,
): string {
  const existing = fs.existsSync(existingPath) ? fs.readFileSync(existingPath, 'utf-8') : '';
  if (existing.trim() === '') {
    return renderMarkdown(contexts, options);
  }

  const sections = contexts.map((context) => formatVersion(context, options)).join('\n');
  if (existing.startsWith('## ')) {
    return `${sections}\n${existing}`;
  }

  const headerEnd = existing.indexOf('\n## ');
  if (headerEnd === -1) {
    return `${existing.trimEnd()}\n\n${sections}`;
  }
  return `${existing.slice(0, headerEnd).trimEnd()}\n\n${sections}\n${existing.slice(headerEnd + 1)}`;
}

export function writeMarkdown(
  outputPath: string,
  contexts: TemplateContext[],
  config: Config,
  dryRun: boolean,
  options?: FormatVersionOptions,
): void {
  const content = renderMarkdown(contexts, options);

  const label = /changelog/i.test(outputPath) ? 'Changelog' : 'Release notes';

  if (dryRun) {
    info(`[DRY RUN] ${label} preview (would write to ${outputPath}):`);
    info(content);
    return;
  }

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (outputPath === '-') {
    process.stdout.write(content);
    return;
  }

  const updated = config.updateStrategy === 'regenerate' ? content : prependVersions(outputPath, contexts, options);
  fs.writeFileSync(outputPath, updated, 'utf-8');

  success(`${label} written to ${outputPath}`);
}
