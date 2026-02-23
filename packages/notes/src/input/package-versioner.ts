import * as fs from 'node:fs';
import type { VersionOutput } from '@releasekit/core';
import type { ChangelogEntry, ChangelogInput, PackageChangelog } from '../core/types.js';
import { InputParseError } from '../errors/index.js';

function normalizeEntryType(type: string): ChangelogEntry['type'] {
  const typeMap: Record<string, ChangelogEntry['type']> = {
    added: 'added',
    feat: 'added',
    feature: 'added',
    changed: 'changed',
    update: 'changed',
    refactor: 'changed',
    deprecated: 'deprecated',
    removed: 'removed',
    fixed: 'fixed',
    fix: 'fixed',
    security: 'security',
    sec: 'security',
  };

  return typeMap[type.toLowerCase()] ?? 'changed';
}

export function parsePackageVersioner(json: string): ChangelogInput {
  let data: VersionOutput;

  try {
    data = JSON.parse(json);
  } catch (error) {
    throw new InputParseError(`Invalid JSON input: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!data.changelogs || !Array.isArray(data.changelogs)) {
    throw new InputParseError('Input must contain a "changelogs" array');
  }

  const packages: PackageChangelog[] = data.changelogs.map((changelog) => ({
    packageName: changelog.packageName,
    version: changelog.version,
    previousVersion: changelog.previousVersion,
    revisionRange: changelog.revisionRange,
    repoUrl: changelog.repoUrl,
    date: new Date().toISOString().split('T')[0] ?? '',
    entries: changelog.entries.map((entry) => ({
      type: normalizeEntryType(entry.type),
      description: entry.description,
      issueIds: entry.issueIds,
      scope: entry.scope,
      originalType: entry.originalType,
      breaking: entry.breaking ?? entry.originalType?.includes('!') ?? false,
    })),
  }));

  const repoUrl = packages[0]?.repoUrl ?? null;

  return {
    source: 'package-versioner',
    packages,
    metadata: {
      repoUrl: repoUrl ?? undefined,
    },
  };
}

export function parsePackageVersionerFile(filePath: string): ChangelogInput {
  const content = fs.readFileSync(filePath, 'utf-8');
  return parsePackageVersioner(content);
}

export async function parsePackageVersionerStdin(): Promise<ChangelogInput> {
  const chunks: string[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }

  const content = chunks.join('');
  return parsePackageVersioner(content);
}
