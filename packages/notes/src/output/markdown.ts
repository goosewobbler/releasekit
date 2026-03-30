import * as fs from 'node:fs';
import * as path from 'node:path';
import { info, success } from '@releasekit/core';
import type { ChangelogEntry, Config, TemplateContext } from '../core/types.js';

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

function formatEntry(entry: ChangelogEntry): string {
  let line: string;

  if (entry.breaking && entry.scope) {
    line = `- **BREAKING** **${entry.scope}**: ${entry.description}`;
  } else if (entry.breaking) {
    line = `- **BREAKING** ${entry.description}`;
  } else if (entry.scope) {
    line = `- **${entry.scope}**: ${entry.description}`;
  } else {
    line = `- ${entry.description}`;
  }

  if (entry.issueIds && entry.issueIds.length > 0) {
    line += ` (${entry.issueIds.join(', ')})`;
  }

  return line;
}

export interface FormatVersionOptions {
  /** Include the package name in the version header (e.g. `## [pkg@1.0.0]`). */
  includePackageName?: boolean;
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

  const grouped = groupEntriesByType(context.entries);

  for (const [type, entries] of grouped) {
    if (entries.length === 0) continue;

    lines.push(`### ${TYPE_LABELS[type]}`);
    for (const entry of entries) {
      lines.push(formatEntry(entry));
    }
    lines.push('');
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
