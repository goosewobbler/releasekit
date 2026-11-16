import * as fs from 'node:fs';
import * as path from 'node:path';
import { info, success } from '@releasekit/core';
import { detectMonorepo } from '../monorepo/aggregator.js';

/** `packageCount` is the release's, not the run's: see `writeVersionedNotes`. */
export function nestsReleaseNotes(packageCount: number): boolean {
  return detectMonorepo(process.cwd()).isMonorepo || packageCount > 1;
}

/**
 * `nested` MUST reflect whether the *repo* has more than one package - not how many packages are in
 * this run. An independently-versioned monorepo releases one package per pipeline invocation, so a
 * flat path would silently overwrite another package that shares a version number.
 */
export function writeVersionedNotes<T extends { packageName: string; version: string }>(
  contexts: T[],
  directory: string,
  dryRun: boolean,
  nested: boolean,
  renderContent: (ctx: T) => string,
): string[] {
  const written: string[] = [];

  for (const ctx of contexts) {
    const outputPath = nested
      ? path.join(directory, ctx.packageName, `${ctx.version}.md`)
      : path.join(directory, `${ctx.version}.md`);
    const content = renderContent(ctx);

    if (dryRun) {
      info(`[DRY RUN] Release notes (would write to ${outputPath}):`);
      info(content);
      continue;
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, content, 'utf-8');
    success(`Release notes written to ${outputPath}`);
    written.push(outputPath);
  }

  return written;
}
