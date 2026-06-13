import * as fs from 'node:fs';
import * as path from 'node:path';
import { info, success } from '@releasekit/core';
import type { TemplateContext } from '../core/types.js';
import { type FormatVersionOptions, renderMarkdown } from './markdown.js';

/**
 * Write one immutable Markdown file per package version under `directory`.
 *
 * Layout: `release-notes/<package>/<version>.md` for monorepos (more than one package in the
 * release), collapsing to `release-notes/<version>.md` for a single package. Unlike the rolling
 * root/packages outputs, each release writes a *new* file keyed by version, so prior versions are
 * never overwritten; re-running the same release rewrites the same file idempotently.
 *
 * Standalone so both the live pipeline and the notes-backfill command (#293) can write the same
 * per-version history.
 */
export function writeVersionedNotes(
  contexts: TemplateContext[],
  directory: string,
  dryRun: boolean,
  options?: FormatVersionOptions,
): string[] {
  const written: string[] = [];
  // Single-package (and sync) releases don't need a package subdirectory — the version is enough.
  const nested = contexts.length > 1;

  for (const ctx of contexts) {
    const outputPath = nested
      ? path.join(directory, ctx.packageName, `${ctx.version}.md`)
      : path.join(directory, `${ctx.version}.md`);
    // Each file is a single package's notes; the path already identifies the package, so the
    // version heading doesn't repeat the name.
    const content = renderMarkdown([ctx], { ...options, includePackageName: false });

    if (dryRun) {
      info(`[DRY RUN] Release notes (would write to ${outputPath}):`);
      info(content);
      continue;
    }

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(outputPath, content, 'utf-8');
    success(`Release notes written to ${outputPath}`);
    written.push(outputPath);
  }

  return written;
}
