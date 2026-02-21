import type { ChangelogInput, PackageChangelog } from '../core/types.js';
import { InputParseError } from '../errors/index.js';

export function parseManualInput(json: string): ChangelogInput {
  let data: unknown;

  try {
    data = JSON.parse(json);
  } catch (error) {
    throw new InputParseError(`Invalid JSON input: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (typeof data !== 'object' || data === null) {
    throw new InputParseError('Input must be a JSON object');
  }

  const input = data as Record<string, unknown>;

  const packages: PackageChangelog[] = [];

  if (Array.isArray(input.packages)) {
    for (const pkg of input.packages) {
      if (typeof pkg !== 'object' || pkg === null) continue;

      const p = pkg as Record<string, unknown>;

      packages.push({
        packageName: typeof p.packageName === 'string' ? p.packageName : 'package',
        version: typeof p.version === 'string' ? p.version : '0.0.0',
        previousVersion: typeof p.previousVersion === 'string' ? p.previousVersion : null,
        revisionRange: typeof p.revisionRange === 'string' ? p.revisionRange : 'HEAD',
        repoUrl: typeof p.repoUrl === 'string' ? p.repoUrl : null,
        date: typeof p.date === 'string' ? p.date : (new Date().toISOString().split('T')[0] ?? ''),
        entries: Array.isArray(p.entries) ? p.entries.map(normalizeEntry) : [],
      });
    }
  }

  if (packages.length === 0) {
    packages.push({
      packageName: 'package',
      version: '0.0.0',
      previousVersion: null,
      revisionRange: 'HEAD',
      repoUrl: null,
      date: new Date().toISOString().split('T')[0] ?? '',
      entries: [],
    });
  }

  return {
    source: 'manual',
    packages,
    metadata: {
      repoUrl: typeof input.repoUrl === 'string' ? input.repoUrl : undefined,
    },
  };
}

function normalizeEntry(entry: unknown): import('../core/types.js').ChangelogEntry {
  if (typeof entry !== 'object' || entry === null) {
    return { type: 'changed', description: 'Unknown change' };
  }

  const e = entry as Record<string, unknown>;

  return {
    type: normalizeType(e.type),
    description: typeof e.description === 'string' ? e.description : 'Unknown change',
    scope: typeof e.scope === 'string' ? e.scope : undefined,
    issueIds: Array.isArray(e.issueIds) ? e.issueIds.map(String) : undefined,
    breaking: typeof e.breaking === 'boolean' ? e.breaking : undefined,
    originalType: typeof e.originalType === 'string' ? e.originalType : undefined,
  };
}

function normalizeType(type: unknown): import('../core/types.js').ChangelogType {
  const validTypes = ['added', 'changed', 'deprecated', 'removed', 'fixed', 'security'] as const;

  if (typeof type === 'string' && validTypes.includes(type as (typeof validTypes)[number])) {
    return type as (typeof validTypes)[number];
  }

  const typeMap: Record<string, (typeof validTypes)[number]> = {
    feat: 'added',
    feature: 'added',
    fix: 'fixed',
    bugfix: 'fixed',
    change: 'changed',
    update: 'changed',
    refactor: 'changed',
    remove: 'removed',
    delete: 'removed',
    deprecate: 'deprecated',
    sec: 'security',
  };

  if (typeof type === 'string') {
    const mapped = typeMap[type.toLowerCase()];
    if (mapped) return mapped;
  }

  return 'changed';
}
