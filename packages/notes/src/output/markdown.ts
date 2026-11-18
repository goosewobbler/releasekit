import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  type ChangelogRefsMode,
  type ChangelogSection,
  groupChangelogSections,
  info,
  PROJECT_WIDE_HEADING,
  renderChangelogBlock,
  renderChangelogEntryLine,
  success,
  warn,
} from '@releasekit/core';
import type { ChangelogEntry, FirstReleaseConfig, LinksConfig, TemplateContext } from '../core/types.js';

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

/** Shared with the template context, so templates group entries as this renderer does. */
export function versionSections(
  context: TemplateContext,
  categoryOrder?: string[],
): ChangelogSection<ChangelogEntry>[] {
  const categories = context.enhanced?.categories;
  return groupChangelogSections(
    context.entries,
    (e) => e,
    categories ? { categories, order: categoryOrder } : undefined,
  );
}

export function sharedPackageBlock(context: TemplateContext, refs: ChangelogRefsMode): string | undefined {
  return context.sharedEntries?.length
    ? renderChangelogBlock(PROJECT_WIDE_HEADING, 3, context.sharedEntries, refs, context.repoUrl)
    : undefined;
}

export function formatVersion(context: TemplateContext, options?: FormatVersionOptions): string {
  const refs = options?.refs ?? 'link';

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

  const categories = context.enhanced?.categories;
  for (const section of versionSections(context, options?.categoryOrder)) {
    blocks.push(
      `### ${section.label}`,
      section.items.map((entry) => renderChangelogEntryLine(entry, refs, context.repoUrl)).join('\n'),
    );
  }

  if (categories && categories.length > 0) {
    const links = resolveLinks(context.entries, options?.links);
    if (links.length > 0) {
      blocks.push(
        `### ${options?.links?.title ?? 'Links'}`,
        links.map((link) => `- [${link.label}](${link.url})`).join('\n'),
      );
    }
  }

  const shared = sharedPackageBlock(context, refs);
  if (shared) {
    blocks.push(shared);
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

/** `sharedEntries` are listed once, after the versions, under a dated heading of their own. */
export function renderMarkdown(
  contexts: TemplateContext[],
  options?: FormatVersionOptions,
  sharedEntries: ChangelogEntry[] = [],
): string {
  const sections: string[] = [formatHeader()];

  for (const context of contexts) {
    sections.push(formatVersion(context, options));
  }

  const first = contexts[0];
  if (first && sharedEntries.length > 0) {
    const heading = `${PROJECT_WIDE_HEADING} - ${first.date}`;
    sections.push(`${renderChangelogBlock(heading, 2, sharedEntries, options?.refs ?? 'link', first.repoUrl)}\n`);
  }

  return sections.join('\n');
}

function versionSectionsStart(rendered: string): number {
  if (rendered.startsWith('## ')) {
    return 0;
  }
  const index = rendered.indexOf('\n## ');
  return index === -1 ? -1 : index + 1;
}

function prependChangelog(existingPath: string, rendered: string): string {
  const existing = fs.existsSync(existingPath) ? fs.readFileSync(existingPath, 'utf-8') : '';
  if (existing.trim() === '') {
    return rendered;
  }

  const sectionsStart = versionSectionsStart(rendered);
  if (sectionsStart === -1) {
    warn(`Rendered changelog has no version section (a line starting with "## "); nothing added to ${existingPath}`);
    return existing;
  }
  const sections = `${rendered.slice(sectionsStart).trimEnd()}\n`;

  const headerEnd = versionSectionsStart(existing);
  if (headerEnd === 0) {
    return `${sections}\n${existing}`;
  }
  if (headerEnd === -1) {
    return `${existing.trimEnd()}\n\n${sections}`;
  }
  return `${existing.slice(0, headerEnd).trimEnd()}\n\n${sections}\n${existing.slice(headerEnd)}`;
}

export function writeChangelog(outputPath: string, content: string, dryRun: boolean): void {
  if (dryRun) {
    info(`[DRY RUN] Changelog preview (would write to ${outputPath}):`);
    info(content);
    return;
  }

  if (outputPath === '-') {
    process.stdout.write(content);
    return;
  }

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outputPath, prependChangelog(outputPath, content), 'utf-8');
  success(`Changelog written to ${outputPath}`);
}
