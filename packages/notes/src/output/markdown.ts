import * as fs from 'node:fs';
import * as path from 'node:path';
import { debug, info, success } from '@releasekit/core';
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

export function formatVersion(context: TemplateContext): string {
  const lines: string[] = [];

  const versionHeader = context.previousVersion ? `## [${context.version}]` : `## ${context.version}`;

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

export function renderMarkdown(contexts: TemplateContext[]): string {
  const sections: string[] = [formatHeader()];

  for (const context of contexts) {
    sections.push(formatVersion(context));
  }

  return sections.join('\n');
}

export function prependVersion(existingPath: string, context: TemplateContext): string {
  let existing = '';

  if (fs.existsSync(existingPath)) {
    existing = fs.readFileSync(existingPath, 'utf-8');

    const headerEnd = existing.indexOf('\n## ');
    if (headerEnd >= 0) {
      const header = existing.slice(0, headerEnd);
      const body = existing.slice(headerEnd + 1);

      const newVersion = formatVersion(context);
      return `${header}\n\n${newVersion}\n${body}`;
    }
  }

  return renderMarkdown([context]);
}

export function writeMarkdown(outputPath: string, contexts: TemplateContext[], config: Config, dryRun: boolean): void {
  const content = renderMarkdown(contexts);

  if (dryRun) {
    info(`Would write changelog to ${outputPath}`);
    debug('--- Changelog Preview ---');
    debug(content);
    debug('--- End Preview ---');
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

  if (config.updateStrategy === 'prepend' && fs.existsSync(outputPath) && contexts.length === 1) {
    const firstContext = contexts[0];
    if (firstContext) {
      const updated = prependVersion(outputPath, firstContext);
      fs.writeFileSync(outputPath, updated, 'utf-8');
    }
  } else {
    fs.writeFileSync(outputPath, content, 'utf-8');
  }

  success(`Changelog written to ${outputPath}`);
}
