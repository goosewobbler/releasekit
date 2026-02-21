import * as fs from 'node:fs';
import type { ChangelogEntry, ChangelogInput, PackageChangelog } from '../core/types.js';
import { InputParseError } from '../errors/index.js';

// Matches: ## [1.2.3] - 2024-01-15  or  ## 1.2.3 (2024-01-15)  or  # [1.2.3](url) (2024-01-15)
const VERSION_HEADER = /^#{1,2}\s+\[?v?([\d.]+(?:-[\w.]+)?)\]?(?:\([^)]*\))?\s*[-–]?\s*\(?(\d{4}-\d{2}-\d{2})?\)?/;

// Matches Keep a Changelog section headers: ### Added, ### Fixed, etc.
const SECTION_HEADER = /^###\s+(.+)$/;

// Matches bullet entries: - description  or  * description
const BULLET = /^[-*]\s+(.+)$/;

// Matches scope prefix: **scope**: description  or  **scope:** description
const SCOPE_PREFIX = /^\*\*([^*]+)\*\*:?\s+(.+)$/;

// Matches issue references: (#123)  or  [#123](url)  or  (closes #123)
const ISSUE_REF = /(?:\[)?(#\d+)(?:\]\([^)]*\))?/g;

const SECTION_TYPE_MAP: Record<string, ChangelogEntry['type']> = {
  added: 'added',
  new: 'added',
  features: 'added',
  feature: 'added',
  changed: 'changed',
  changes: 'changed',
  updated: 'changed',
  update: 'changed',
  refactored: 'changed',
  performance: 'changed',
  'performance improvements': 'changed',
  deprecated: 'deprecated',
  removed: 'removed',
  fixed: 'fixed',
  'bug fixes': 'fixed',
  bugfixes: 'fixed',
  fixes: 'fixed',
  security: 'security',
};

function normalizeSectionType(header: string): ChangelogEntry['type'] {
  return SECTION_TYPE_MAP[header.toLowerCase().trim()] ?? 'changed';
}

function extractIssueIds(text: string): { description: string; issueIds: string[] } {
  const issueIds: string[] = [];
  let match: RegExpExecArray | null;
  ISSUE_REF.lastIndex = 0;

  match = ISSUE_REF.exec(text);
  while (match !== null) {
    issueIds.push(match[1] as string);
    match = ISSUE_REF.exec(text);
  }

  // Strip issue refs and trailing parenthetical groups from description
  const description = text
    .replace(/\s*\((?:closes\s+)?(?:#\d+(?:,\s*)?)+\)/gi, '')
    .replace(/\s*\[#\d+\]\([^)]*\)/g, '')
    .trim();

  return { description, issueIds };
}

function parseEntry(line: string, sectionType: ChangelogEntry['type']): ChangelogEntry | null {
  const bulletMatch = line.match(BULLET);
  if (!bulletMatch) return null;

  let rawText = bulletMatch[1] ?? '';
  let scope: string | undefined;
  let breaking = false;

  // Detect BREAKING CHANGE prefix
  if (/^\*\*BREAKING\*\*/i.test(rawText) || /^BREAKING CHANGE/i.test(rawText)) {
    breaking = true;
    rawText = rawText.replace(/^\*\*BREAKING\*\*\s*/i, '').replace(/^BREAKING CHANGE:\s*/i, '');
  }

  // Detect scope prefix: **scope**: text
  const scopeMatch = rawText.match(SCOPE_PREFIX);
  if (scopeMatch) {
    scope = scopeMatch[1];
    rawText = scopeMatch[2] ?? rawText;
  }

  const { description, issueIds } = extractIssueIds(rawText);

  return {
    type: sectionType,
    description,
    scope,
    breaking: breaking || undefined,
    issueIds: issueIds.length > 0 ? issueIds : undefined,
  };
}

interface VersionBlock {
  version: string;
  date: string;
  entries: ChangelogEntry[];
}

function parseVersionBlocks(content: string): VersionBlock[] {
  const lines = content.split('\n');
  const blocks: VersionBlock[] = [];

  let currentBlock: VersionBlock | null = null;
  let currentSectionType: ChangelogEntry['type'] = 'changed';

  for (const line of lines) {
    const versionMatch = line.match(VERSION_HEADER);
    if (versionMatch && (line.startsWith('## ') || line.startsWith('# '))) {
      if (currentBlock) {
        blocks.push(currentBlock);
      }

      const version = versionMatch[1] ?? '0.0.0';
      const date = versionMatch[2] ?? new Date().toISOString().split('T')[0] ?? '';

      currentBlock = { version, date, entries: [] };
      currentSectionType = 'changed';
      continue;
    }

    if (!currentBlock) continue;

    const sectionMatch = line.match(SECTION_HEADER);
    if (sectionMatch) {
      currentSectionType = normalizeSectionType(sectionMatch[1] ?? '');
      continue;
    }

    const entry = parseEntry(line, currentSectionType);
    if (entry) {
      currentBlock.entries.push(entry);
    }
  }

  if (currentBlock) {
    blocks.push(currentBlock);
  }

  return blocks;
}

export function parseConventionalChangelog(
  content: string,
  packageName = 'package',
  repoUrl: string | null = null,
): ChangelogInput {
  if (!content.trim()) {
    throw new InputParseError('Changelog content is empty');
  }

  const blocks = parseVersionBlocks(content);

  if (blocks.length === 0) {
    throw new InputParseError('No version sections found in changelog. Expected "## [x.y.z] - date" headers.');
  }

  const packages: PackageChangelog[] = blocks.map((block, index) => ({
    packageName,
    version: block.version,
    previousVersion: blocks[index + 1]?.version ?? null,
    revisionRange: `v${blocks[index + 1]?.version ?? ''}..v${block.version}`,
    repoUrl,
    date: block.date,
    entries: block.entries,
  }));

  return {
    source: 'conventional-changelog',
    packages,
    metadata: {
      repoUrl: repoUrl ?? undefined,
    },
  };
}

export function parseConventionalChangelogFile(
  filePath: string,
  packageName?: string,
  repoUrl: string | null = null,
): ChangelogInput {
  if (!fs.existsSync(filePath)) {
    throw new InputParseError(`Changelog file not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const derivedName = packageName ?? filePath.split('/').at(-2) ?? 'package';

  return parseConventionalChangelog(content, derivedName, repoUrl);
}
