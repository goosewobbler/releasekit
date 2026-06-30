import * as fs from 'node:fs';
import * as path from 'node:path';
import { type ChangelogRefsMode, escapeChangelogMentions, info, renderIssueRefs, success } from '@releasekit/core';
import type {
  ChangelogEntry,
  Config,
  EnhancedCategory,
  FirstReleaseConfig,
  LinksConfig,
  TemplateContext,
} from '../core/types.js';

const DEFAULT_FIRST_RELEASE_TEXT = '_First release of ${packageName}._';

/**
 * The placeholder intro line for a first release, or `undefined` when not a first release or disabled.
 * The default text is a true statement so it reads fine even when published unedited (automated modes).
 */
export function firstReleaseLine(context: TemplateContext, config?: FirstReleaseConfig | false): string | undefined {
  if (!context.isFirstRelease || config === false) return undefined;
  const template = config?.text ?? DEFAULT_FIRST_RELEASE_TEXT;
  return template.replaceAll('${packageName}', context.packageName).replaceAll('${version}', context.version);
}

const TYPE_ORDER: ChangelogEntry['type'][] = ['added', 'changed', 'deprecated', 'removed', 'fixed', 'security'];

const TYPE_LABELS: Record<ChangelogEntry['type'], string> = {
  added: 'Added',
  changed: 'Changed',
  deprecated: 'Deprecated',
  removed: 'Removed',
  fixed: 'Fixed',
  security: 'Security',
};

function groupEntriesByType(entries: ChangelogEntry[]): Map<ChangelogEntry['type'], ChangelogEntry[]> {
  const grouped = new Map<ChangelogEntry['type'], ChangelogEntry[]>();

  for (const type of TYPE_ORDER) {
    grouped.set(type, []);
  }

  for (const entry of entries) {
    const existing = grouped.get(entry.type) ?? [];
    existing.push(entry);
    grouped.set(entry.type, existing);
  }

  return grouped;
}

interface EntryRefOptions {
  hideScope?: boolean;
  /** How bare `#NNN` issue/PR refs are rendered (default `'link'`). */
  refs?: ChangelogRefsMode;
  /** Repo URL used to build canonical issue links in `link` mode. */
  repoUrl?: string | null;
}

function formatEntry(entry: ChangelogEntry, opts?: EntryRefOptions): string {
  // GitHub treats a bare `@scope/pkg` / `@user` in prose as a mention (stray link, can ping a real
  // org/team on a release PR) — always neutralise it, regardless of the refs mode. The scope and
  // lead-in are interpolated as bold prose too (a scoped package name like `@wdio/native-cdp-bridge`
  // would mention `@wdio`), so escape all three, not just the description.
  const description = escapeChangelogMentions(entry.description);
  const scope = entry.scope ? escapeChangelogMentions(entry.scope) : undefined;
  const leadIn = entry.leadIn ? escapeChangelogMentions(entry.leadIn) : undefined;
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

  const refs = renderIssueRefs(entry.issueIds ?? [], opts?.refs ?? 'link', opts?.repoUrl ?? null);
  if (refs) {
    line += ` (${refs})`;
  }

  return line;
}

function formatCategorySection(name: string, entries: ChangelogEntry[], refOpts: EntryRefOptions): string[] {
  const lines: string[] = [];
  lines.push(`### ${name}`);

  // Identify scopes that appear on 2+ entries → group them
  const scopeCounts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.scope) scopeCounts.set(entry.scope, (scopeCounts.get(entry.scope) ?? 0) + 1);
  }
  const groupedScopes = new Set<string>();
  for (const [scope, count] of scopeCounts) {
    if (count > 1) groupedScopes.add(scope);
  }

  if (groupedScopes.size === 0) {
    // No scope grouping — render flat
    for (const entry of entries) {
      lines.push(formatEntry(entry, refOpts));
    }
  } else {
    // Scope groups are expanded at the position of their first member.
    // Ungrouped entries that fall between two members of the same group
    // will appear after that group, not at their literal original position.
    const byScope = new Map<string, ChangelogEntry[]>();
    for (const entry of entries) {
      if (entry.scope && groupedScopes.has(entry.scope)) {
        const group = byScope.get(entry.scope) ?? [];
        group.push(entry);
        byScope.set(entry.scope, group);
      }
    }

    const renderedScopes = new Set<string>();
    for (const entry of entries) {
      if (entry.scope && groupedScopes.has(entry.scope)) {
        if (!renderedScopes.has(entry.scope)) {
          renderedScopes.add(entry.scope);
          lines.push(`**${escapeChangelogMentions(entry.scope)}**:`);
          for (const e of byScope.get(entry.scope) ?? []) {
            lines.push(formatEntry(e, { ...refOpts, hideScope: true }));
          }
        }
        // Remaining entries in this group already rendered above — skip
      } else {
        lines.push(formatEntry(entry, refOpts));
      }
    }
  }

  lines.push('');
  return lines;
}

function rerouteBreakingEntries(categories: EnhancedCategory[]): EnhancedCategory[] {
  const hasBreaking = categories.some((c) => c.entries.some((e) => e.breaking));
  if (!hasBreaking) return categories;

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

  const breakingCatIdx = stripped.findIndex((c) => c.name === 'Breaking');
  if (breakingCatIdx >= 0) {
    return stripped.map((c, i) => (i === breakingCatIdx ? { ...c, entries: [...breakingEntries, ...c.entries] } : c));
  }
  // Create a "Breaking" category if it doesn't exist yet
  return [{ name: 'Breaking', entries: breakingEntries }, ...stripped.filter((c) => c.entries.length > 0)];
}

function applyOrder(categories: EnhancedCategory[], order: string[]): EnhancedCategory[] {
  if (order.length === 0) return categories;
  return [...categories].sort((a, b) => {
    const ai = order.indexOf(a.name);
    const bi = order.indexOf(b.name);
    // Breaking not in order: pin before all explicitly-ordered categories
    const rank = (name: string, idx: number) => (idx === -1 ? (name === 'Breaking' ? -1 : order.length) : idx);
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
    if (bracketOpen === -1) return null;
    const bracketClose = text.indexOf(']', bracketOpen + 1);
    if (bracketClose === -1) return null;
    if (text[bracketClose + 1] !== '(') {
      search = bracketClose + 1;
      continue;
    }
    const parenClose = text.indexOf(')', bracketClose + 2);
    if (parenClose === -1) return null;
    const label = text.slice(bracketOpen + 1, bracketClose);
    const url = text.slice(bracketClose + 2, parenClose);
    if (/^https?:\/\//.test(url)) return { label, url };
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
        if (!trimmed.startsWith(marker)) continue;
        const rest = trimmed.slice(marker.length).trim();
        const mdLink = parseMdLink(rest);
        if (mdLink) {
          if (!seen.has(mdLink.url)) {
            seen.add(mdLink.url);
            links.push(mdLink);
          }
        } else if (/^https?:\/\//.test(rest)) {
          const url = rest.split(/\s/)[0]!;
          if (!seen.has(url)) {
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
  if (!linksConfig) return [];
  const items = linksConfig.items ?? [];
  const discovered = linksConfig.fromPRBodyMarker
    ? extractLinksFromPRBodies(entries, linksConfig.fromPRBodyMarker)
    : [];
  // Merge, de-dup by URL (explicit items take precedence)
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
  /** Include the package name in the version header (e.g. `## [pkg@1.0.0]`). */
  includePackageName?: boolean;
  /** Order to render LLM-categorised sections. Only applies when enhanced.categories is present. */
  categoryOrder?: string[];
  /** Migration/doc links to render at the end of the release notes section. */
  links?: LinksConfig;
  /** First-release placeholder intro config, or `false` to suppress it. */
  firstRelease?: FirstReleaseConfig | false;
  /** How bare `#NNN` issue/PR refs are rendered (`changelog.refs`; default `'link'`). */
  refs?: ChangelogRefsMode;
}

export function formatVersion(context: TemplateContext, options?: FormatVersionOptions): string {
  const lines: string[] = [];
  const refOpts: EntryRefOptions = { refs: options?.refs ?? 'link', repoUrl: context.repoUrl };

  const versionLabel =
    options?.includePackageName && context.packageName ? `${context.packageName}@${context.version}` : context.version;
  const versionHeader = context.previousVersion ? `## [${versionLabel}]` : `## ${versionLabel}`;

  lines.push(`${versionHeader} - ${context.date}`);
  lines.push('');

  const introLine = firstReleaseLine(context, options?.firstRelease);
  if (introLine) {
    lines.push(introLine);
    lines.push('');
  }

  if (context.compareUrl) {
    lines.push(`[Full Changelog](${context.compareUrl})`);
    lines.push('');
  }

  if (context.enhanced?.summary) {
    lines.push(context.enhanced.summary);
    lines.push('');
  }

  if (context.enhanced?.categories && context.enhanced.categories.length > 0) {
    // LLM-enhanced path: category-based rendering with breaking re-routing and scope grouping
    let categories = rerouteBreakingEntries(context.enhanced.categories);
    categories = applyOrder(categories, options?.categoryOrder ?? []);

    for (const category of categories) {
      if (category.entries.length === 0) continue;
      lines.push(...formatCategorySection(category.name, category.entries, refOpts));
    }

    const links = resolveLinks(context.entries, options?.links);
    if (links.length > 0) {
      lines.push(`### ${options?.links?.title ?? 'Links'}`);
      for (const link of links) {
        lines.push(`- [${link.label}](${link.url})`);
      }
      lines.push('');
    }
  } else {
    // Non-LLM / changelog path: type-based grouping
    const grouped = groupEntriesByType(context.entries);

    for (const [type, entries] of grouped) {
      if (entries.length === 0) continue;

      lines.push(`### ${TYPE_LABELS[type]}`);
      for (const entry of entries) {
        lines.push(formatEntry(entry, refOpts));
      }
      lines.push('');
    }
  }

  return lines.join('\n');
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

export function prependVersion(existingPath: string, context: TemplateContext, options?: FormatVersionOptions): string {
  let existing = '';

  if (fs.existsSync(existingPath)) {
    existing = fs.readFileSync(existingPath, 'utf-8');

    const headerEnd = existing.indexOf('\n## ');
    if (headerEnd >= 0) {
      const header = existing.slice(0, headerEnd);
      const body = existing.slice(headerEnd + 1);

      const newVersion = formatVersion(context, options);
      return `${header}\n\n${newVersion}\n${body}`;
    }
  }

  return renderMarkdown([context]);
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

  if (config.updateStrategy !== 'regenerate' && fs.existsSync(outputPath) && contexts.length === 1) {
    const firstContext = contexts[0];
    if (firstContext) {
      const updated = prependVersion(outputPath, firstContext, options);
      fs.writeFileSync(outputPath, updated, 'utf-8');
    }
  } else {
    // NOTE: prepend only applies to single-context writes. A multi-package changelog 'root' release
    // overwrites this file with just the current release's sections — prior history is lost. The
    // aggregating-prepend path (writeMonorepoChangelogs 'root' branch) is currently unreachable from
    // the pipeline. Monorepos wanting a durable per-release history can use release-notes file output
    // (`releaseNotes.file.dir`, immutable per-version files) or changelog `mode: 'packages'`.
    fs.writeFileSync(outputPath, content, 'utf-8');
  }

  success(`${label} written to ${outputPath}`);
}
