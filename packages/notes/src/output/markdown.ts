import * as fs from 'node:fs';
import * as path from 'node:path';
import { info, success } from '@releasekit/core';
import type { ChangelogEntry, Config, EnhancedCategory, LinksConfig, TemplateContext } from '../core/types.js';

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

function formatEntry(entry: ChangelogEntry, opts?: { hideScope?: boolean }): string {
  let line: string;

  if (entry.leadIn && entry.breaking) {
    line = `- **BREAKING** **${entry.leadIn}**: ${entry.description}`;
  } else if (entry.leadIn) {
    line = `- **${entry.leadIn}**: ${entry.description}`;
  } else if (entry.breaking && entry.scope && !opts?.hideScope) {
    line = `- **BREAKING** **${entry.scope}**: ${entry.description}`;
  } else if (entry.breaking) {
    line = `- **BREAKING** ${entry.description}`;
  } else if (entry.scope && !opts?.hideScope) {
    line = `- **${entry.scope}**: ${entry.description}`;
  } else {
    line = `- ${entry.description}`;
  }

  if (entry.issueIds && entry.issueIds.length > 0) {
    line += ` (${entry.issueIds.join(', ')})`;
  }

  return line;
}

function formatCategorySection(name: string, entries: ChangelogEntry[]): string[] {
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
      lines.push(formatEntry(entry));
    }
  } else {
    // Render in a single pass preserving original order.
    // When a grouped scope is first encountered, expand the full group inline.
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
          lines.push(`**${entry.scope}**:`);
          for (const e of byScope.get(entry.scope) ?? []) {
            lines.push(formatEntry(e, { hideScope: true }));
          }
        }
        // Remaining entries in this group already rendered above — skip
      } else {
        lines.push(formatEntry(entry));
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

function extractLinksFromPRBodies(entries: ChangelogEntry[], marker: string): LinkItem[] {
  const seen = new Set<string>();
  const links: LinkItem[] = [];
  for (const entry of entries) {
    for (const pr of entry.context?.prs ?? []) {
      for (const line of pr.body.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith(marker)) continue;
        const rest = trimmed.slice(marker.length).trim();
        const mdMatch = rest.match(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/);
        if (mdMatch) {
          if (!seen.has(mdMatch[2]!)) {
            seen.add(mdMatch[2]!);
            links.push({ label: mdMatch[1]!, url: mdMatch[2]! });
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
}

export function formatVersion(context: TemplateContext, options?: FormatVersionOptions): string {
  const lines: string[] = [];

  const versionLabel =
    options?.includePackageName && context.packageName ? `${context.packageName}@${context.version}` : context.version;
  const versionHeader = context.previousVersion ? `## [${versionLabel}]` : `## ${versionLabel}`;

  lines.push(`${versionHeader} - ${context.date}`);
  lines.push('');

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
      lines.push(...formatCategorySection(category.name, category.entries));
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
        lines.push(formatEntry(entry));
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
    fs.writeFileSync(outputPath, content, 'utf-8');
  }

  success(`${label} written to ${outputPath}`);
}
